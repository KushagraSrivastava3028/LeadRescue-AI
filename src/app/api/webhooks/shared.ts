import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CapabilityUnavailable, twilioConfig } from '@/lib/server/providers/config';
import { query, transaction } from '@/lib/server/providers/database';
import { decryptToken } from '@/lib/server/providers/encryption';
import { verifyTwilioSignature } from '@/lib/server/providers/telephony';
import { classifyKeyword, isUsPhone } from '@/lib/domain/recovery';

export class WebhookError extends Error {
  constructor(public status: number) {
    super('Webhook rejected');
  }
}
export async function rawBody(request: Request, max = 32_768): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > max || declared < 0) throw new WebhookError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookError(400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new WebhookError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function webhookResponse(error: unknown): Response {
  return new Response('Webhook unavailable', {
    status:
      error instanceof WebhookError
        ? error.status
        : error instanceof CapabilityUnavailable
          ? 503
          : 503,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
export interface PhoneMapping {
  id: string;
  business_id: string;
  phone: string;
  forward_to: string | null;
  destination_verified_at: Date | null;
  routing_enabled: boolean;
  registration_status: string;
  account_sid: string;
  token_ciphertext: string | null;
}
export async function verifiedTwilio(
  request: Request,
  receivingField: 'To' | 'From',
): Promise<{ params: Record<string, string>; mapping: PhoneMapping; eventKey: string }> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
    throw new WebhookError(415);
  const config = twilioConfig();
  const raw = await rawBody(request);
  const form = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  for (const [key, value] of form) {
    if (Object.hasOwn(params, key) || key.length > 80 || value.length > 4096)
      throw new WebhookError(400);
    params[key] = value;
  }
  const accountSid = z
    .string()
    .regex(/^AC[a-fA-F0-9]{32}$/)
    .safeParse(params.AccountSid);
  if (!accountSid.success || !isUsPhone(params[receivingField] ?? '')) throw new WebhookError(400);
  const [mapping] = await query<PhoneMapping>(
    "select n.*,a.account_sid,a.token_ciphertext from public.phone_numbers n join public.provider_accounts a on a.id=n.provider_account_id and a.business_id=n.business_id where a.provider='twilio' and a.account_sid=$1 and n.phone=$2",
    [accountSid.data, params[receivingField]],
  );
  if (!mapping) throw new WebhookError(403);
  const authToken = mapping.token_ciphertext
    ? decryptToken(mapping.token_ciphertext, mapping.business_id)
    : mapping.account_sid === config.accountSid
      ? config.authToken
      : null;
  if (!authToken) throw new WebhookError(503);
  const url = new URL(request.url);
  const signedUrl = `${config.webhookOrigin}${url.pathname}${url.search}`;
  if (
    !verifyTwilioSignature(
      request.headers.get('x-twilio-signature') ?? '',
      signedUrl,
      params,
      authToken,
    )
  )
    throw new WebhookError(403);
  const admission = await query<{ result: { allowed: boolean } }>(
    'select public.consume_rate_limit($1,2400,60) result',
    [`webhook:twilio:${mapping.id}`],
  );
  if (!admission[0]?.result.allowed) throw new WebhookError(429);
  const intentId = url.searchParams.get('intent');
  if (intentId) {
    if (!z.string().uuid().safeParse(intentId).success) throw new WebhookError(400);
    params._intentId = intentId;
  }
  // Signed payload composite identity distinguishes every callback, including repeated status/sequence.
  const canonical = Object.keys(params)
    .sort()
    .map((key) => [key, params[key]]);
  const eventKey = `${url.pathname}:${createHash('sha256')
    .update(JSON.stringify([url.search, canonical]))
    .digest('hex')}`;
  return { params, mapping, eventKey };
}
export async function persistTwilio(input: {
  mapping: PhoneMapping;
  params: Record<string, string>;
  eventKey: string;
  topic: string;
}): Promise<void> {
  await transaction(async (db) => {
    await db.query("select public.persist_webhook($1,'twilio',$2,$3::jsonb,$4)", [
      input.mapping.business_id,
      input.eventKey,
      JSON.stringify({ ...input.params, _phoneNumberId: input.mapping.id }),
      input.topic,
    ]);
    // STOP takes effect at admission, in the same durable transaction, before any acknowledgement.
    const optedOutPhone =
      input.topic === 'twilio.sms' &&
      classifyKeyword(input.params.Body ?? '', input.params.OptOutType) === 'stop'
        ? input.params.From
        : input.topic === 'twilio.message_status' && input.params.ErrorCode === '21610'
          ? input.params.To
          : null;
    if (optedOutPhone && isUsPhone(optedOutPhone)) {
      const contact = await db.query<{ id: string }>(
        'insert into public.contacts(business_id,phone) values($1,$2) on conflict(business_id,phone) do update set phone=excluded.phone returning id',
        [input.mapping.business_id, optedOutPhone],
      );
      await db.query(
        "insert into public.suppressions(business_id,contact_id,reason,provider_synced) values($1,$2,'customer_stop',true) on conflict(business_id,contact_id) where cleared_at is null do nothing",
        [input.mapping.business_id, contact.rows[0].id],
      );
      await db.query(
        'update public.consents set revoked_at=coalesce(revoked_at,now()) where business_id=$1 and contact_id=$2 and revoked_at is null',
        [input.mapping.business_id, contact.rows[0].id],
      );
      await db.query(
        "update public.messages set status='suppressed',error_code='opted_out',updated_at=now() where business_id=$1 and contact_id=$2 and direction='outbound' and status='pending'",
        [input.mapping.business_id, contact.rows[0].id],
      );
    }
  });
}
