import { createHash } from 'node:crypto';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { verifyCookie } from '@/lib/server/signed-cookie';
import { createServiceClient } from '@/lib/server/supabase';
import {
  checkDatabaseError,
  clientRateIdentity,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from '@/lib/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const tokenSchema = z.string().min(20).max(2048);
const grantSchema = z.object({ businessId: uuidSchema, appointmentId: uuidSchema });
async function authorizedAppointment(token: string) {
  let grant;
  try {
    grant = grantSchema.parse(await verifyCookie(token, 'appointment-confirmation'));
  } catch {
    throw new HttpError(
      404,
      'request_unavailable',
      'This confirmation link is invalid or has expired.',
    );
  }
  const service = createServiceClient();
  const result = await service
    .from('appointments')
    .select('id,start_at,end_at,status,customer_confirmed_at')
    .eq('business_id', grant.businessId)
    .eq('id', grant.appointmentId)
    .maybeSingle();
  checkDatabaseError(result.error);
  if (!result.data || Date.parse(result.data.start_at) <= Date.now())
    throw new HttpError(
      404,
      'request_unavailable',
      'This inspection request is no longer available.',
    );
  return { grant, service, appointment: result.data };
}

export async function POST(request: Request) {
  try {
    const input = await readJson(
      request,
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('view'), token: tokenSchema }).strict(),
        z
          .object({ action: z.literal('confirm'), token: tokenSchema, confirm: z.literal(true) })
          .strict(),
      ]),
      4096,
    );
    await enforceRateLimit('appointment:source', clientRateIdentity(request), 60, 900);
    const { grant, service, appointment } = await authorizedAppointment(input.token);
    if (input.action === 'view') {
      const business = await service
        .from('businesses')
        .select('name,timezone')
        .eq('id', grant.businessId)
        .maybeSingle();
      checkDatabaseError(business.error);
      return jsonResponse({ ok: true, business: business.data, appointment });
    }
    await enforceRateLimit(
      'appointment:confirm',
      `${grant.businessId}:${grant.appointmentId}:${clientRateIdentity(request)}`,
      5,
      900,
    );
    const evidenceHash = createHash('sha256')
      .update(`customer-confirmation-v1:${input.token}`)
      .digest('hex');
    const { data, error } = await service.rpc('confirm_appointment', {
      p_business_id: grant.businessId,
      p_appointment_id: grant.appointmentId,
      p_evidence_hash: evidenceHash,
    });
    checkDatabaseError(error);
    return jsonResponse(
      {
        ok: true,
        status: data,
        message:
          data === 'confirmed'
            ? 'Your inspection is confirmed.'
            : data === 'pending'
              ? "Thank you. Your request is being checked against the team's calendar. The team will confirm the booking."
              : 'Thank you. Your request has been saved and the team will contact you to arrange the inspection.',
      },
      data === 'confirmed' ? 200 : 202,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
