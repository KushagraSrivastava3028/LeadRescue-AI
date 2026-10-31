import { type PoolClient } from 'pg';
import { dispatchDecision, isUsPhone } from '../lib/domain/recovery';
import { query, transaction } from '../lib/server/providers/database';
import { twilioConfig } from '../lib/server/providers/config';
import { decryptToken } from '../lib/server/providers/encryption';
import { notifyTeam } from '../lib/server/providers/notifications';
import { sendSms } from '../lib/server/providers/telephony';

interface ContextRow {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string;
  body: string;
  status: string;
  author: string;
  idempotency_key: string;
  created_at: Date;
  mode: string;
  last_outbound_at: Date | null;
  dispatching_until: Date | null;
  phone: string;
  sms_eligible: boolean;
  from_phone: string;
  registration_status: string;
  account_sid: string;
  token_ciphertext: string | null;
  timezone: string;
  quiet_start: number;
  quiet_end: number;
  consent: boolean;
  suppressed: boolean;
  automation_enabled: boolean;
  valid_until: Date | null;
  sms_used: number;
  sms_limit: number;
  state: string;
  suspended_at: Date | null;
  automation_hold_at: Date | null;
  review_required_at: Date | null;
}
const CONTEXT_SQL = `select m.*,c.mode,c.last_outbound_at,c.dispatching_until,t.phone,t.sms_eligible,n.phone from_phone,n.registration_status,a.account_sid,a.token_ciphertext,p.timezone,p.quiet_start,p.quiet_end,
  exists(select 1 from public.consents co where co.business_id=m.business_id and co.contact_id=m.contact_id and co.sender_phone=n.phone and co.revoked_at is null and co.granted_at<=now() and (co.expires_at is null or co.expires_at>now()) and (co.scope='service_recovery' or (coalesce(m.idempotency_key,'') not like 'recovery:%' and co.scope='conversation_reply'))) consent,
  exists(select 1 from public.suppressions s where s.business_id=m.business_id and s.contact_id=m.contact_id and s.cleared_at is null) suppressed,
  e.automation_enabled,e.valid_until,e.sms_used,e.sms_limit,b.state,b.suspended_at,b.automation_hold_at,s.review_required_at
  from public.messages m join public.conversations c on c.business_id=m.business_id and c.id=m.conversation_id
  join public.contacts t on t.business_id=m.business_id and t.id=m.contact_id
  join public.business_profiles p on p.business_id=m.business_id
  join public.businesses b on b.id=m.business_id join public.entitlements e on e.business_id=m.business_id join public.subscriptions s on s.business_id=m.business_id
  join lateral(select * from public.phone_numbers where business_id=m.business_id order by created_at limit 1)n on true
  join public.provider_accounts a on a.business_id=m.business_id and a.id=n.provider_account_id
  where m.business_id=$1 and m.id=$2`;

async function releaseUsage(db: PoolClient, businessId: string, key: string): Promise<void> {
  const events = await db.query<{ quantity: number }>(
    "update public.usage_events set status='released' where business_id=$1 and idempotency_key=$2 and status='reserved' returning quantity",
    [businessId, key],
  );
  if (events.rows[0])
    await db.query(
      'update public.entitlements set sms_used=greatest(0,sms_used-$2),updated_at=now() where business_id=$1',
      [businessId, events.rows[0].quantity],
    );
}

function decision(row: ContextRow, now: Date, budgetReserved = false) {
  return dispatchDecision({
    now,
    createdAt: new Date(row.created_at),
    consent: row.consent,
    suppressed: row.suppressed,
    registrationReady: row.registration_status === 'approved',
    contactEligible: row.sms_eligible && isUsPhone(row.phone),
    automationActive:
      row.automation_enabled &&
      !!row.valid_until &&
      new Date(row.valid_until) > now &&
      !row.suspended_at &&
      !row.automation_hold_at &&
      !row.review_required_at &&
      !['canceled', 'automation_paused'].includes(row.state),
    budgetAvailable: budgetReserved || row.sms_used < row.sms_limit,
    humanTakeover: row.mode === 'human',
    manual: row.author === 'human',
    timezone: row.timezone,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    lastOutboundAt: row.last_outbound_at ? new Date(row.last_outbound_at) : null,
  });
}

export async function dispatchMessage(businessId: string, messageId: string): Promise<void> {
  const context = await transaction(async (db) => {
    // Lock message, then conversation, then entitlement (reserve_usage) in a fixed order.
    const message = await db.query<{ conversation_id: string; status: string }>(
      'select conversation_id,status from public.messages where business_id=$1 and id=$2 for update',
      [businessId, messageId],
    );
    if (!message.rows[0]) throw new Error('Message unavailable');
    if (message.rows[0].status !== 'pending') return null;
    await db.query(
      'select id from public.conversations where business_id=$1 and id=$2 for update',
      [businessId, message.rows[0].conversation_id],
    );
    const result = await db.query<ContextRow>(CONTEXT_SQL, [businessId, messageId]);
    const row = result.rows[0];
    if (!row) {
      await db.query(
        "update public.messages set status='suppressed',error_code='configuration_required' where business_id=$1 and id=$2",
        [businessId, messageId],
      );
      return null;
    }
    if (row.dispatching_until && new Date(row.dispatching_until) > new Date())
      throw new Error('Conversation dispatch lease busy');
    const check = decision(row, new Date());
    if (!check.allowed || row.body.length > 480) {
      const reason = !check.allowed ? check.reason : 'message_too_long';
      await db.query(
        "update public.messages set status='suppressed',error_code=$3,updated_at=now() where business_id=$1 and id=$2",
        [businessId, messageId, reason],
      );
      await db.query(
        "update public.leads set status='needs_callback',updated_at=now() where business_id=$1 and id=(select lead_id from public.conversations where business_id=$1 and id=$2)",
        [businessId, row.conversation_id],
      );
      await db.query(
        "insert into public.notifications(business_id,type,message) values($1,'manual_callback',$2)",
        [businessId, `An enquiry needs a manual callback. SMS was withheld: ${reason}.`],
      );
      return null;
    }
    // Conservative UCS-2 segment reservation; no automatic overage billing.
    const segments = Math.max(1, Math.ceil(row.body.length / 67));
    const platformLimit = Number(process.env.PLATFORM_DAILY_SMS_SEGMENT_LIMIT);
    if (!Number.isInteger(platformLimit) || platformLimit < 1)
      throw new Error('Platform SMS segment limit must be configured');
    await db.query('select pg_advisory_xact_lock(749303)');
    const platform = await db.query<{ used: string }>(
      "select coalesce(sum(quantity),0)::text used from public.usage_events where kind='sms' and status<>'released' and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')",
    );
    if (Number(platform.rows[0].used) + segments > platformLimit)
      throw new Error('Platform SMS segment limit reached');
    await db.query("select public.reserve_usage($1,'sms',$2,$3)", [
      businessId,
      `sms:${messageId}`,
      segments,
    ]);
    await db.query(
      "update public.messages set status='submitted',send_intent_at=now(),updated_at=now() where business_id=$1 and id=$2",
      [businessId, messageId],
    );
    await db.query(
      "update public.conversations set dispatching_until=now()+interval '30 seconds' where business_id=$1 and id=$2",
      [businessId, row.conversation_id],
    );
    return row;
  });
  if (!context) return;
  // No network side effect occurs inside a database transaction. Current state is checked again at the send boundary.
  const [fresh] = await query<ContextRow>(CONTEXT_SQL, [businessId, messageId]);
  const check = fresh
    ? decision(fresh, new Date(), true)
    : { allowed: false as const, reason: 'configuration_changed' };
  if (!check.allowed) {
    await transaction(async (db) => {
      await db.query(
        "update public.messages set status='suppressed',error_code=$3,updated_at=now() where business_id=$1 and id=$2",
        [businessId, messageId, check.reason],
      );
      await releaseUsage(db, businessId, `sms:${messageId}`);
      await db.query(
        'update public.conversations set dispatching_until=null where business_id=$1 and id=$2',
        [businessId, context.conversation_id],
      );
    });
    return;
  }
  try {
    const config = twilioConfig();
    const authToken = context.token_ciphertext
      ? decryptToken(context.token_ciphertext, businessId)
      : context.account_sid === config.accountSid
        ? config.authToken
        : undefined;
    if (!authToken) throw new Error('Provider account credentials unavailable');
    const sent = await sendSms({
      accountSid: context.account_sid,
      authToken,
      from: context.from_phone,
      to: context.phone,
      body: context.body,
      statusCallback: `${config.webhookOrigin}/api/webhooks/twilio/message-status?intent=${messageId}`,
    });
    await transaction(async (db) => {
      // A fast delivery callback may already have advanced the row. Do not regress it.
      await db.query(
        "update public.messages set provider_id=coalesce(provider_id,$3),status=case when status in ('pending','submitted','unknown') then 'submitted' else status end,updated_at=now() where business_id=$1 and id=$2",
        [businessId, messageId, sent.sid],
      );
      await db.query(
        "update public.usage_events set status='settled' where business_id=$1 and idempotency_key=$2 and status='reserved'",
        [businessId, `sms:${messageId}`],
      );
      await db.query(
        'update public.conversations set dispatching_until=null,last_outbound_at=now(),updated_at=now() where business_id=$1 and id=$2',
        [businessId, context.conversation_id],
      );
    });
  } catch {
    // A timeout or DB failure after provider acceptance has an UNKNOWN outcome. Never blindly retry.
    await transaction(async (db) => {
      await db.query(
        "update public.messages set status='unknown',error_code='provider_outcome_unknown',updated_at=now() where business_id=$1 and id=$2 and status in ('submitted','pending')",
        [businessId, messageId],
      );
      await db.query(
        "update public.usage_events set status='unknown' where business_id=$1 and idempotency_key=$2 and status='reserved'",
        [businessId, `sms:${messageId}`],
      );
      await db.query(
        'update public.conversations set dispatching_until=null where business_id=$1 and id=$2',
        [businessId, context.conversation_id],
      );
    });
    await notifyTeam({
      businessId,
      type: 'delivery_unknown',
      message:
        'An SMS has an unknown provider outcome. Reconcile the send intent with provider logs before attempting another message.',
    });
  }
}
