import 'server-only';
import twilio from 'twilio';
import { z } from 'zod';
import { isUsPhone } from '@/lib/domain/recovery';
import { twilioConfig } from './config';

function client(accountSid?: string, authToken?: string) {
  const config = twilioConfig();
  return twilio(accountSid ?? config.accountSid, authToken ?? config.authToken, {
    timeout: 10000,
    autoRetry: false,
  });
}

export function verifyTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
  authToken: string,
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}
export function voiceXml(input: { forwardTo?: string; actionUrl?: string }): string {
  const response = new twilio.twiml.VoiceResponse();
  if (input.forwardTo && isUsPhone(input.forwardTo) && input.actionUrl) {
    response
      .dial({ action: input.actionUrl, method: 'POST', timeout: 25, answerOnBridge: true })
      .number(input.forwardTo);
  } else {
    response.say('We are unable to connect your call. Please contact the business directly.');
    response.hangup();
  }
  return response.toString();
}
export function emptyMessagingXml(): string {
  return new twilio.twiml.MessagingResponse().toString();
}

export async function sendSms(input: {
  accountSid: string;
  authToken?: string;
  from: string;
  to: string;
  body: string;
  statusCallback: string;
}): Promise<{ sid: string; status: string }> {
  if (!isUsPhone(input.from) || !isUsPhone(input.to))
    throw new Error('Unsupported messaging geography');
  const body = z.string().min(1).max(480).parse(input.body);
  const message = await client(input.accountSid, input.authToken).messages.create({
    from: input.from,
    to: input.to,
    body,
    statusCallback: input.statusCallback,
  });
  return { sid: message.sid, status: message.status };
}

export async function provisionNumber(input: {
  businessId: string;
  areaCode: string;
  accountSid?: string;
  authToken?: string;
}): Promise<{ sid: string; phoneNumber: string }> {
  z.string().uuid().parse(input.businessId);
  const areaCode = z
    .string()
    .regex(/^[2-9]\d{2}$/)
    .parse(input.areaCode);
  const config = twilioConfig();
  const sdk = client(input.accountSid, input.authToken);
  const available = await sdk
    .availablePhoneNumbers('US')
    .local.list({ areaCode: Number(areaCode), smsEnabled: true, voiceEnabled: true, limit: 1 });
  if (!available[0]) throw new Error('No eligible number available');
  const number = await sdk.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    friendlyName: `LeadRescue ${input.businessId}`,
    voiceUrl: `${config.webhookOrigin}/api/webhooks/twilio/voice`,
    voiceMethod: 'POST',
    smsUrl: `${config.webhookOrigin}/api/webhooks/twilio/sms`,
    smsMethod: 'POST',
  });
  // Persistence/compensation and one-number ownership must be handled by the caller's operation ledger.
  return { sid: number.sid, phoneNumber: number.phoneNumber };
}

export async function requestForwardingVerification(
  phone: string,
  credentials?: { accountSid: string; authToken?: string },
): Promise<{ callSid: string; validationCode: string }> {
  if (!isUsPhone(phone)) throw new Error('Unsupported destination');
  const result = await client(
    credentials?.accountSid,
    credentials?.authToken,
  ).validationRequests.create({
    phoneNumber: phone,
    friendlyName: 'LeadRescue forwarding destination',
  });
  return { callSid: result.callSid, validationCode: String(result.validationCode) };
}
