import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { requireMembership, requireRecentSignIn } from '@/lib/server/authorization';
import { createServiceClient } from '@/lib/server/supabase';
import {
  checkDatabaseError,
  enforceRateLimit,
  errorResponse,
  jsonResponse,
  readJson,
} from '@/lib/server/security';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const input = await readJson(request, z.object({ businessId: uuidSchema }).strict());
    const { client, user, business } = await requireMembership(input.businessId, 'billing');
    requireRecentSignIn(user);
    await enforceRateLimit('workspace:export', `${input.businessId}:${user.id}`, 3, 3600);
    const [leads, messages, appointments] = await Promise.all([
      client
        .from('leads')
        .select('id,service,status,summary,created_at,contacts(name,phone,zip_code)', {
          count: 'exact',
        })
        .eq('business_id', input.businessId)
        .order('created_at', { ascending: false })
        .limit(1000),
      client
        .from('messages')
        .select('id,conversation_id,direction,body,status,author,created_at', { count: 'exact' })
        .eq('business_id', input.businessId)
        .order('created_at', { ascending: false })
        .limit(5000),
      client
        .from('appointments')
        .select('id,lead_id,status,start_at,end_at', { count: 'exact' })
        .eq('business_id', input.businessId)
        .order('start_at', { ascending: false })
        .limit(1000),
    ]);
    for (const result of [leads, messages, appointments]) checkDatabaseError(result.error);
    const audit = await createServiceClient()
      .from('audit_logs')
      .insert({
        business_id: input.businessId,
        actor_user_id: user.id,
        action: 'workspace.exported',
        resource_id: input.businessId,
        metadata: {
          format: 'json',
          lead_count: leads.data?.length ?? 0,
          message_count: messages.data?.length ?? 0,
        },
      });
    checkDatabaseError(audit.error);
    const data = {
      exportedAt: new Date().toISOString(),
      business: { id: business.id, name: business.name },
      limits: { leads: 1000, messages: 5000, appointments: 1000 },
      truncated:
        (leads.count ?? 0) > 1000 ||
        (messages.count ?? 0) > 5000 ||
        (appointments.count ?? 0) > 1000,
      leads: leads.data,
      messages: messages.data,
      appointments: appointments.data,
    };
    return jsonResponse(data, 200, {
      'Content-Disposition': `attachment; filename="leadrescue-export-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
