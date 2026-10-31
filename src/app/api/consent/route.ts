import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { requireMembership } from '@/lib/server/authorization';
import { createServiceClient } from '@/lib/server/supabase';
import {
  checkDatabaseError,
  enforceRateLimit,
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
} from '@/lib/server/security';

export const dynamic = 'force-dynamic';
/** Evidence submission never grants consent. An approved operator process validates it first. */
export async function POST(request: Request) {
  try {
    const input = await readJson(
      request,
      z
        .object({
          businessId: uuidSchema,
          leadId: uuidSchema,
          source: z.enum(['signed_form', 'recorded_authorization']),
          policyVersion: z.string().trim().min(1).max(80),
          evidenceReference: z.string().trim().min(5).max(200),
        })
        .strict(),
      2048,
    );
    const { client, user } = await requireMembership(input.businessId, 'lead');
    await enforceRateLimit('consent:review', `${input.businessId}:${user.id}`, 20, 3600);
    const lead = await client
      .from('leads')
      .select('id,contact_id')
      .eq('business_id', input.businessId)
      .eq('id', input.leadId)
      .maybeSingle();
    checkDatabaseError(lead.error);
    if (!lead.data) throw new HttpError(404, 'lead_unavailable', 'This lead is unavailable.');
    const service = createServiceClient();
    const notification = await service
      .from('notifications')
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        type: 'consent_review_required',
        message:
          'Consent evidence was submitted for operator review. Automated texting remains subject to verified consent and all other dispatch checks.',
      });
    checkDatabaseError(notification.error);
    const audit = await service
      .from('audit_logs')
      .insert({
        business_id: input.businessId,
        actor_user_id: user.id,
        action: 'consent.review_requested',
        resource_id: lead.data.contact_id,
        metadata: {
          source: input.source,
          policy_version: input.policyVersion,
          evidence_reference: input.evidenceReference,
        },
      });
    checkDatabaseError(audit.error);
    return jsonResponse(
      {
        ok: true,
        status: 'pending_review',
        message: 'Evidence submitted for operator review. This does not grant texting permission.',
      },
      202,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
