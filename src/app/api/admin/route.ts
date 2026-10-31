import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { requirePlatformAdmin, requireRecentSignIn } from '@/lib/server/authorization';
import {
  checkDatabaseError,
  enforceRateLimit,
  errorResponse,
  jsonResponse,
  readJson,
} from '@/lib/server/security';

export const dynamic = 'force-dynamic';
const schema = z
  .object({
    action: z.enum(['inspect', 'pause']),
    businessId: uuidSchema,
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export async function GET() {
  try {
    await requirePlatformAdmin();
    return jsonResponse({ ok: true, authorized: true, actions: ['inspect', 'pause'] });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const input = await readJson(request, schema);
    const { user, client, service } = await requirePlatformAdmin();
    requireRecentSignIn(user);
    await enforceRateLimit('admin:operations', user.id, 20, 60);
    if (input.action === 'pause') {
      const { error } = await client.rpc('admin_pause_automation', {
        p_business_id: input.businessId,
        p_reason: input.reason,
      });
      checkDatabaseError(error);
      return jsonResponse({
        ok: true,
        message:
          'Automation paused. Ordinary call routing and suppression processing remain available.',
      });
    }
    const [business, outbox, jobs] = await Promise.all([
      service
        .from('businesses')
        .select('id,name,state,created_at,suspended_at')
        .eq('id', input.businessId)
        .maybeSingle(),
      service
        .from('outbox')
        .select('id,topic,attempts,available_at,processed_at')
        .eq('business_id', input.businessId)
        .is('processed_at', null)
        .order('created_at')
        .limit(50),
      service
        .from('job_attempts')
        .select('id,status,error_code,created_at')
        .eq('business_id', input.businessId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    for (const item of [business, outbox, jobs]) checkDatabaseError(item.error);
    const audit = await service
      .from('audit_logs')
      .insert({
        business_id: input.businessId,
        actor_user_id: user.id,
        action: 'admin.operations_read',
        resource_id: input.businessId,
        metadata: { reason: input.reason },
      });
    checkDatabaseError(audit.error);
    return jsonResponse({
      ok: true,
      business: business.data,
      pendingEvents: outbox.data,
      attempts: jobs.data,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
