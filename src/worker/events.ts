import { randomUUID } from 'node:crypto';
import { type PoolClient } from 'pg';
import {
  advanceDelivery,
  classifyKeyword,
  isRecoverableCall,
  isUsPhone,
  recoveryText,
  type DeliveryStatus,
} from '../lib/domain/recovery';
import { transaction } from '../lib/server/providers/database';

type Payload = Record<string, string>;
interface EventRow {
  id: string;
  business_id: string;
  payload: Payload;
  processed_at: Date | null;
}

async function ensureEnquiry(
  db: PoolClient,
  businessId: string,
  phone: string,
  callId?: string,
): Promise<{ contactId: string; leadId: string; conversationId: string }> {
  if (!isUsPhone(phone)) throw new Error('Unsupported contact');
  const contact = await db.query<{ id: string }>(
    'insert into public.contacts(business_id,phone) values($1,$2) on conflict(business_id,phone) do update set phone=excluded.phone returning id',
    [businessId, phone],
  );
  const contactId = contact.rows[0].id;
  const existing = await db.query<{ lead_id: string; id: string }>(
    "select c.lead_id,c.id from public.conversations c join public.leads l on l.business_id=c.business_id and l.id=c.lead_id where c.business_id=$1 and c.contact_id=$2 and l.status not in ('won','lost') and l.created_at>now()-interval '7 days' order by l.created_at desc limit 1",
    [businessId, contactId],
  );
  if (existing.rows[0])
    return { contactId, leadId: existing.rows[0].lead_id, conversationId: existing.rows[0].id };
  const lead = await db.query<{ id: string }>(
    'insert into public.leads(business_id,contact_id,call_id) values($1,$2,$3) returning id',
    [businessId, contactId, callId ?? null],
  );
  const conversation = await db.query<{ id: string }>(
    'insert into public.conversations(business_id,lead_id,contact_id) values($1,$2,$3) returning id',
    [businessId, lead.rows[0].id, contactId],
  );
  return { contactId, leadId: lead.rows[0].id, conversationId: conversation.rows[0].id };
}

export async function processTwilioEvent(
  businessId: string,
  eventId: string,
  topic: string,
): Promise<void> {
  await transaction(async (db) => {
    const event = await db.query<EventRow>(
      'select id,business_id,payload,processed_at from public.webhook_events where business_id=$1 and id=$2 for update',
      [businessId, eventId],
    );
    const row = event.rows[0];
    if (!row) throw new Error('Event unavailable');
    if (row.processed_at) return;
    const p = row.payload;
    if (topic === 'twilio.voice' || topic === 'twilio.call_status') {
      // Every callback carries original caller/receiving number. Separate parent vs Dial child.
      const parent = await db.query<{ id: string }>(
        'insert into public.calls(business_id,phone_number_id,call_sid,from_phone,to_phone,status) values($1,$2,$3,$4,$5,$6) on conflict(call_sid) do update set updated_at=now() where calls.business_id=excluded.business_id returning id',
        [
          businessId,
          p._phoneNumberId,
          p.CallSid,
          p.From ?? 'unknown',
          p.To ?? 'unknown',
          topic === 'twilio.voice' ? 'ringing' : 'completed',
        ],
      );
      if (!parent.rows[0]) throw new Error('Call tenant mismatch');
      if (topic === 'twilio.call_status') {
        const existing = await db.query<{ outcome: string; sequence_number: number }>(
          'select outcome,sequence_number from public.call_legs where business_id=$1 and call_sid=$2 for update',
          [businessId, p.DialCallSid],
        );
        const incomingSequence = Number(p.SequenceNumber ?? 0);
        const previous = existing.rows[0];
        // Dial action is the terminal outcome. A contradictory later terminal is an operator review.
        if (!previous) {
          await db.query(
            'insert into public.call_legs(business_id,call_id,call_sid,parent_call_sid,outcome,sequence_number,duration_seconds) values($1,$2,$3,$4,$5,$6,$7)',
            [
              businessId,
              parent.rows[0].id,
              p.DialCallSid,
              p.CallSid,
              p.DialCallStatus,
              Number.isFinite(incomingSequence) ? incomingSequence : 0,
              Math.max(0, Math.min(86400, Number(p.DialCallDuration ?? 0) || 0)),
            ],
          );
        }
        if (previous && previous.outcome !== p.DialCallStatus) {
          await db.query(
            "insert into public.notifications(business_id,type,message) values($1,'call_review','Conflicting forwarded call outcomes require review. Recovery was not repeated.')",
            [businessId],
          );
        } else if (isRecoverableCall(p.DialCallStatus, true) && isUsPhone(p.From ?? '')) {
          await db.query(
            'update public.calls set status=$3,recovery_eligible=true,updated_at=now() where business_id=$1 and id=$2',
            [businessId, parent.rows[0].id, p.DialCallStatus],
          );
          const enquiry = await ensureEnquiry(db, businessId, p.From, parent.rows[0].id);
          const profile = await db.query<{ name: string }>(
            'select name from public.business_profiles where business_id=$1',
            [businessId],
          );
          const message = await db.query<{ id: string }>(
            "insert into public.messages(business_id,conversation_id,contact_id,direction,body,author,idempotency_key) values($1,$2,$3,'outbound',$4,'ai',$5) on conflict(business_id,idempotency_key) do nothing returning id",
            [
              businessId,
              enquiry.conversationId,
              enquiry.contactId,
              recoveryText(profile.rows[0]?.name ?? 'the roofing team'),
              `recovery:${p.CallSid}`,
            ],
          );
          if (message.rows[0])
            await db.query(
              "insert into public.outbox(business_id,topic,payload) values($1,'sms.send',$2::jsonb)",
              [
                businessId,
                JSON.stringify({
                  messageId: message.rows[0].id,
                  conversationId: enquiry.conversationId,
                  manual: false,
                }),
              ],
            );
          await db.query(
            "insert into public.notifications(business_id,lead_id,type,message) values($1,$2,'missed_call','A missed-call enquiry was saved. SMS will be sent only if current consent and eligibility checks pass.')",
            [businessId, enquiry.leadId],
          );
        } else if (p.DialCallStatus === 'completed') {
          await db.query(
            "update public.calls set status='completed',updated_at=now() where business_id=$1 and id=$2",
            [businessId, parent.rows[0].id],
          );
        }
      }
    } else if (topic === 'twilio.sms') {
      const enquiry = await ensureEnquiry(db, businessId, p.From);
      const message = await db.query<{ id: string }>(
        "insert into public.messages(business_id,conversation_id,contact_id,provider_id,direction,body,status,author,idempotency_key) values($1,$2,$3,$4,'inbound',$5,'received','customer',$6) on conflict(provider_id) do nothing returning id",
        [
          businessId,
          enquiry.conversationId,
          enquiry.contactId,
          p.MessageSid,
          (p.Body || '[Non-text message]').slice(0, 1600),
          `inbound:${p.MessageSid}`,
        ],
      );
      if (message.rows[0]) {
        await db.query(
          'update public.conversations set last_inbound_at=now(),updated_at=now() where business_id=$1 and id=$2',
          [businessId, enquiry.conversationId],
        );
        const keyword = classifyKeyword(p.Body ?? '', p.OptOutType);
        if (keyword === 'stop') {
          await db.query(
            "update public.leads set status='needs_callback',updated_at=now() where business_id=$1 and id=$2",
            [businessId, enquiry.leadId],
          );
        } else if (keyword === 'help' || keyword === 'start') {
          // Provider START can clear its own block; our suppression remains until evidence is approved.
          await db.query(
            "insert into public.notifications(business_id,lead_id,type,message) values($1,$2,'consent_review',$3)",
            [
              businessId,
              enquiry.leadId,
              keyword === 'start'
                ? 'A customer requested re-opt-in. Verify the approved consent process before clearing local suppression.'
                : 'A customer requested help. Review the conversation and contact them through an eligible channel.',
            ],
          );
        } else {
          await db.query(
            "insert into public.outbox(business_id,topic,payload) values($1,'ai.qualify',$2::jsonb)",
            [
              businessId,
              JSON.stringify({
                messageId: message.rows[0].id,
                conversationId: enquiry.conversationId,
              }),
            ],
          );
        }
      }
    } else if (topic === 'twilio.message_status') {
      const message = await db.query<{ id: string; status: DeliveryStatus; contact_id: string }>(
        'select id,status,contact_id from public.messages where business_id=$1 and (provider_id=$2 or ($3::uuid is not null and id=$3::uuid)) for update',
        [businessId, p.MessageSid, p._intentId ?? null],
      );
      if (message.rows[0]) {
        const mapped: Record<string, DeliveryStatus> = {
          accepted: 'submitted',
          queued: 'submitted',
          sending: 'submitted',
          scheduled: 'submitted',
          sent: 'sent',
          delivered: 'delivered',
          read: 'delivered',
          undelivered: 'undelivered',
          failed: 'failed',
          canceled: 'failed',
        };
        const status = advanceDelivery(
          message.rows[0].status,
          mapped[p.MessageStatus] ?? 'unknown',
        );
        await db.query(
          'update public.messages set provider_id=coalesce(provider_id,$3),status=$4,error_code=$5,updated_at=now() where business_id=$1 and id=$2',
          [businessId, message.rows[0].id, p.MessageSid, status, p.ErrorCode ?? null],
        );
      }
    } else throw new Error('Unsupported webhook topic');
    await db.query(
      'update public.webhook_events set processed_at=now() where business_id=$1 and id=$2',
      [businessId, eventId],
    );
  });
}

export async function enqueueAutomatedMessage(
  db: PoolClient,
  input: {
    businessId: string;
    conversationId: string;
    contactId: string;
    body: string;
    key: string;
  },
): Promise<void> {
  const messageId = randomUUID();
  const insert = await db.query(
    "insert into public.messages(id,business_id,conversation_id,contact_id,direction,body,author,idempotency_key) values($1,$2,$3,$4,'outbound',$5,'ai',$6) on conflict(business_id,idempotency_key) do nothing returning id",
    [messageId, input.businessId, input.conversationId, input.contactId, input.body, input.key],
  );
  if (insert.rows[0])
    await db.query(
      "insert into public.outbox(business_id,topic,payload) values($1,'sms.send',$2::jsonb)",
      [
        input.businessId,
        JSON.stringify({ messageId, conversationId: input.conversationId, manual: false }),
      ],
    );
}
