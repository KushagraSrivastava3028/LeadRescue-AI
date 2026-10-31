import { nextQuestion, qualifyLead } from '../lib/domain/recovery';
import {
  PROMPT_VERSION,
  qualificationSchema,
  qualifyConversation,
  type Qualification,
} from '../lib/server/providers/ai';
import { integrationEnabled } from '../lib/server/providers/config';
import { query, transaction } from '../lib/server/providers/database';
import { notifyTeam } from '../lib/server/providers/notifications';
import { enqueueAutomatedMessage } from './events';

interface ConversationRow {
  id: string;
  lead_id: string;
  contact_id: string;
  mode: string;
  ai_turns: number;
  name: string;
  services: string[];
  zip_codes: string[];
  daily_ai_cost_limit_minor: number;
}

export async function qualifyMessage(
  businessId: string,
  messageId: string,
  conversationId: string,
): Promise<void> {
  if (!integrationEnabled('AI')) {
    await notifyTeam({
      businessId,
      type: 'ai_unavailable',
      message:
        'A customer replied. AI is not configured; review the enquiry for a manual callback.',
    });
    return;
  }
  const maxCallCost = Number(process.env.AI_MAX_CALL_COST_MINOR);
  const platformBudget = Number(process.env.PLATFORM_DAILY_AI_COST_LIMIT_MINOR);
  if (
    !Number.isInteger(maxCallCost) ||
    maxCallCost < 1 ||
    !Number.isInteger(platformBudget) ||
    platformBudget < 1
  )
    throw new Error('AI cost limits must be configured');
  const input = await transaction(async (db) => {
    await db.query('select pg_advisory_xact_lock(749301)'); // serializes platform budget reservation across worker processes
    const conversations = await db.query<ConversationRow>(
      'select c.*,p.name,p.services,p.zip_codes,e.daily_ai_cost_limit_minor from public.conversations c join public.business_profiles p on p.business_id=c.business_id join public.entitlements e on e.business_id=c.business_id where c.business_id=$1 and c.id=$2 for update of c,e',
      [businessId, conversationId],
    );
    const row = conversations.rows[0];
    if (!row || row.mode !== 'ai' || row.ai_turns >= 8) return null;
    const source = await db.query(
      "select id from public.messages where business_id=$1 and id=$2 and conversation_id=$3 and direction='inbound'",
      [businessId, messageId, conversationId],
    );
    if (!source.rows[0]) throw new Error('Source message unavailable');
    const newest = await db.query<{ id: string }>(
      "select id from public.messages where business_id=$1 and conversation_id=$2 and direction='inbound' order by created_at desc,id desc limit 1",
      [businessId, conversationId],
    );
    if (newest.rows[0]?.id !== messageId) return null;
    const suppressed = await db.query(
      'select id from public.suppressions where business_id=$1 and contact_id=$2 and cleared_at is null',
      [businessId, row.contact_id],
    );
    if (suppressed.rows[0]) return null;
    const existing = await db.query<{ status: string; result: unknown }>(
      'select status,result from private.ai_runs where business_id=$1 and message_id=$2',
      [businessId, messageId],
    );
    if (existing.rows[0]) return null; // submitted/unknown runs require review; completed run already enqueued a deterministic reply
    const budgets = await db.query<{ business_cost: string; platform_cost: string }>(
      "select coalesce(sum(cost_minor) filter(where business_id=$1),0)::text business_cost,coalesce(sum(cost_minor),0)::text platform_cost from public.usage_events where kind='ai' and status<>'released' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
      [businessId],
    );
    if (
      Number(budgets.rows[0].business_cost) + maxCallCost > row.daily_ai_cost_limit_minor ||
      Number(budgets.rows[0].platform_cost) + maxCallCost > platformBudget
    )
      throw new Error('AI daily budget reached');
    await db.query("select public.reserve_usage($1,'ai',$2,1)", [businessId, `ai:${messageId}`]);
    await db.query(
      'update public.usage_events set cost_minor=$3 where business_id=$1 and idempotency_key=$2',
      [businessId, `ai:${messageId}`, maxCallCost],
    );
    await db.query(
      "insert into private.ai_runs(business_id,message_id,status,prompt_version) values($1,$2,'submitted',$3)",
      [businessId, messageId, PROMPT_VERSION],
    );
    const messages = await db.query<{ direction: string; body: string }>(
      'select direction,body from public.messages where business_id=$1 and conversation_id=$2 order by created_at desc limit 12',
      [businessId, conversationId],
    );
    return {
      row,
      messages: messages.rows
        .reverse()
        .map((m) => ({
          role: m.direction === 'inbound' ? ('customer' as const) : ('assistant' as const),
          body: m.body,
        })),
    };
  });
  if (!input) return;
  let result: Qualification;
  try {
    result = qualificationSchema.parse(
      await qualifyConversation({
        services: input.row.services,
        zipCodes: input.row.zip_codes,
        messages: input.messages,
      }),
    );
  } catch {
    await query(
      "update private.ai_runs set status='unknown' where business_id=$1 and message_id=$2",
      [businessId, messageId],
    );
    await query(
      "update public.usage_events set status='unknown' where business_id=$1 and idempotency_key=$2",
      [businessId, `ai:${messageId}`],
    );
    await notifyTeam({
      businessId,
      leadId: input.row.lead_id,
      type: 'ai_review',
      message:
        'AI qualification did not complete. Review the customer enquiry; no AI reply was sent.',
    });
    return;
  }
  await transaction(async (db) => {
    const current = await db.query<{ mode: string; ai_turns: number }>(
      'select mode,ai_turns from public.conversations where business_id=$1 and id=$2 for update',
      [businessId, conversationId],
    );
    await db.query(
      "update private.ai_runs set status='completed',result=$3::jsonb where business_id=$1 and message_id=$2",
      [businessId, messageId, JSON.stringify(result)],
    );
    await db.query(
      "update public.usage_events set status='settled' where business_id=$1 and idempotency_key=$2",
      [businessId, `ai:${messageId}`],
    );
    // A takeover while the model was running must prevent its reply.
    if (current.rows[0]?.mode !== 'ai' || current.rows[0].ai_turns >= 8) return;
    const qualified = qualifyLead(
      result.service,
      result.zip,
      input.row.services,
      input.row.zip_codes,
    );
    await db.query(
      'update public.leads set service=coalesce($3,service),summary=$4,status=$5,updated_at=now() where business_id=$1 and id=$2',
      [
        businessId,
        input.row.lead_id,
        result.service,
        result.summary,
        result.urgent ? 'needs_callback' : qualified ? 'qualified' : 'ai_replying',
      ],
    );
    if (result.zip)
      await db.query('update public.contacts set zip_code=$3 where business_id=$1 and id=$2', [
        businessId,
        input.row.contact_id,
        result.zip,
      ]);
    await db.query(
      'update public.conversations set ai_turns=ai_turns+1,updated_at=now() where business_id=$1 and id=$2',
      [businessId, conversationId],
    );
    await enqueueAutomatedMessage(db, {
      businessId,
      conversationId,
      contactId: input.row.contact_id,
      body: nextQuestion(result, input.row.name),
      key: `reply:${messageId}`,
    });
    if (qualified || result.urgent)
      await db.query(
        'insert into public.notifications(business_id,lead_id,type,message) values($1,$2,$3,$4)',
        [
          businessId,
          input.row.lead_id,
          result.urgent ? 'urgent_enquiry' : 'qualified_lead',
          result.urgent
            ? 'A potentially hazardous roofing enquiry requires human review. No emergency response was promised.'
            : 'A roofing enquiry matches your services and ZIP codes. Review it and arrange a callback.',
        ],
      );
  });
}
