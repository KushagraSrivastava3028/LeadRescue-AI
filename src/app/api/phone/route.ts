import { z } from 'zod';
import { phoneSchema, uuidSchema } from '@/lib/validation';
import { requireMembership, requireRecentSignIn } from '@/lib/server/authorization';
import { createServiceClient } from '@/lib/server/supabase';
import { decryptToken } from '@/lib/server/providers/encryption';
import { provisionNumber, requestForwardingVerification } from '@/lib/server/providers/telephony';
import { CapabilityUnavailable, twilioConfig } from '@/lib/server/providers/config';
import {
  checkDatabaseError,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from '@/lib/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('provision'),
      businessId: uuidSchema,
      areaCode: z.string().regex(/^[2-9]\d{2}$/),
    })
    .strict(),
  z
    .object({ action: z.literal('verify-destination'), businessId: uuidSchema, phone: phoneSchema })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    const businessId = uuidSchema.parse(new URL(request.url).searchParams.get('businessId'));
    const { client, user } = await requireMembership(businessId, 'integration');
    await enforceRateLimit('phone:read', `${businessId}:${user.id}`, 60, 60);
    const result = await client
      .from('phone_numbers')
      .select('phone,forward_to,destination_verified_at,registration_status,routing_enabled')
      .eq('business_id', businessId)
      .maybeSingle();
    checkDatabaseError(result.error);
    return jsonResponse({ ok: true, phone: result.data });
  } catch (error) {
    if (error instanceof z.ZodError)
      return errorResponse(new HttpError(400, 'invalid_request', 'Choose a valid workspace.'));
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = await readJson(request, schema, 2048);
    const { user } = await requireMembership(input.businessId, 'integration');
    requireRecentSignIn(user);
    await enforceRateLimit(`phone:${input.action}`, `${input.businessId}:${user.id}`, 3, 3600);
    twilioConfig(); // Explicit capability gate; disabled means no ledger or provider changes.
    const service = createServiceClient();
    const account = await service
      .from('provider_accounts')
      .select('id,account_sid,token_ciphertext')
      .eq('business_id', input.businessId)
      .eq('provider', 'twilio')
      .maybeSingle();
    checkDatabaseError(account.error);
    if (!account.data?.token_ciphertext)
      throw new CapabilityUnavailable('Operator-assigned Twilio subaccount');
    const credentials = {
      accountSid: account.data.account_sid,
      authToken: decryptToken(account.data.token_ciphertext, input.businessId),
    };
    if (input.action === 'verify-destination') {
      // NANP includes other countries. Provider-verified US destinations are explicitly allowlisted by operators.
      const approved = (process.env.APPROVED_US_FORWARD_DESTINATIONS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!approved.includes(input.phone))
        throw new HttpError(
          409,
          'destination_review_required',
          'Ask the platform operator to approve this US forwarding destination before verification.',
        );
      const receiving = await service
        .from('phone_numbers')
        .select('phone')
        .eq('business_id', input.businessId)
        .maybeSingle();
      checkDatabaseError(receiving.error);
      if (receiving.data?.phone === input.phone)
        throw new HttpError(400, 'routing_loop', 'Choose a different forwarding destination.');
      const result = await requestForwardingVerification(input.phone, credentials);
      const audit = await service
        .from('audit_logs')
        .insert({
          business_id: input.businessId,
          actor_user_id: user.id,
          action: 'phone.destination_verification_requested',
          resource_id: input.businessId,
          metadata: {},
        });
      checkDatabaseError(audit.error);
      return jsonResponse(
        {
          ok: true,
          validationCode: result.validationCode,
          message:
            'Answer the verification call and enter this code. Routing stays disabled until the operator verifies the provider result and assigns the approved destination.',
        },
        202,
      );
    }
    const intent = await service.rpc('begin_phone_provisioning', {
      p_business_id: input.businessId,
    });
    checkDatabaseError(intent.error);
    try {
      const number = await provisionNumber({
        businessId: input.businessId,
        areaCode: input.areaCode,
        ...credentials,
      });
      const persisted = await service.rpc('finish_phone_provisioning', {
        p_operation_id: intent.data,
        p_business_id: input.businessId,
        p_provider_account_id: account.data.id,
        p_sid: number.sid,
        p_phone: number.phoneNumber,
      });
      checkDatabaseError(persisted.error);
      return jsonResponse(
        {
          ok: true,
          phone: number.phoneNumber,
          message:
            'Number assigned. Destination verification and approved messaging registration are required before activation.',
        },
        201,
      );
    } catch {
      // Twilio may have accepted a timed-out purchase. Never blindly purchase a second number.
      await service.rpc('mark_phone_provisioning_unknown', {
        p_operation_id: intent.data,
        p_business_id: input.businessId,
      });
      throw new HttpError(
        409,
        'provisioning_review_required',
        'The number setup outcome requires operator reconciliation. Do not retry the purchase; your operator can check the provider inventory.',
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
