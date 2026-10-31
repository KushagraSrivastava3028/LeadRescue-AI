import 'server-only';
import { query } from './database';

/** Durable in-app owner/team notifications; no unsolicited outbound email or SMS. */
export async function notifyTeam(input: {
  businessId: string;
  leadId?: string | null;
  type: string;
  message: string;
}): Promise<void> {
  await query(
    'insert into public.notifications(business_id,lead_id,type,message) values($1,$2,$3,$4)',
    [input.businessId, input.leadId ?? null, input.type, input.message.slice(0, 500)],
  );
}
