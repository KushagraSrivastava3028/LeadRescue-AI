import 'server-only';
import { z } from 'zod';

const flag = (value: string | undefined) => value === 'true';
const httpsOrigin = z
  .string()
  .url()
  .refine((v) => process.env.NODE_ENV !== 'production' || new URL(v).protocol === 'https:');

export class CapabilityUnavailable extends Error {
  constructor(public readonly capability: string) {
    super(`${capability} is not configured`);
    this.name = 'CapabilityUnavailable';
  }
}
function required(name: string): string {
  const value = process.env[name];
  if (!value || /^(change|replace|your_|placeholder|example)/i.test(value))
    throw new CapabilityUnavailable(name);
  return value;
}
export function integrationEnabled(
  name: 'TWILIO' | 'AI' | 'BILLING' | 'CALENDAR' | 'NOTIFICATIONS',
): boolean {
  return flag(process.env[`${name}_ENABLED`]);
}
export function appOrigin(): string {
  return httpsOrigin.parse(required('APP_ORIGIN')).replace(/\/$/, '');
}
export function databaseUrl(): string {
  const name =
    process.env.LEADRESCUE_PROCESS_KIND === 'worker' && process.env.WORKER_DATABASE_URL
      ? 'WORKER_DATABASE_URL'
      : 'DATABASE_URL';
  return z.string().url().parse(required(name));
}
export function twilioConfig() {
  if (!integrationEnabled('TWILIO')) throw new CapabilityUnavailable('Telephony');
  return {
    accountSid: z
      .string()
      .regex(/^AC[a-fA-F0-9]{32}$/)
      .parse(required('TWILIO_ACCOUNT_SID')),
    authToken: required('TWILIO_AUTH_TOKEN'),
    webhookOrigin: httpsOrigin.parse(required('TWILIO_WEBHOOK_ORIGIN')).replace(/\/$/, ''),
  };
}
export function billingConfig() {
  if (!integrationEnabled('BILLING')) throw new CapabilityUnavailable('Billing');
  const secretKey = required('STRIPE_SECRET_KEY');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.BILLING_LIVE_APPROVED !== 'true' &&
    !secretKey.startsWith('sk_test_')
  )
    throw new CapabilityUnavailable('Approved merchant account');
  return {
    secretKey,
    webhookSecret: required('STRIPE_WEBHOOK_SECRET'),
    priceId: required('STRIPE_PRICE_ID'),
  };
}
export function aiConfig() {
  if (!integrationEnabled('AI')) throw new CapabilityUnavailable('AI qualification');
  // Require an operator-selected snapshot rather than silently changing models.
  return { apiKey: required('OPENAI_API_KEY'), model: required('OPENAI_MODEL') };
}
export function calendarConfig() {
  if (!integrationEnabled('CALENDAR')) throw new CapabilityUnavailable('Calendar');
  const redirectUri = httpsOrigin.parse(required('GOOGLE_REDIRECT_URI'));
  if (redirectUri !== `${appOrigin()}/api/calendar/callback`)
    throw new CapabilityUnavailable('Calendar redirect allowlist');
  return {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri,
  };
}
export function encryptionConfig() {
  const key = Buffer.from(required('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new CapabilityUnavailable('Token encryption key');
  return {
    key,
    version: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,32}$/)
      .parse(required('TOKEN_ENCRYPTION_KEY_VERSION')),
  };
}
