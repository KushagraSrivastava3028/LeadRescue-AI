/** Exact read shapes used by /api/workspace and adjacent main-screen APIs.
 * The benchmark uses synthetic IDs and SQL equivalents of PostgREST filters.
 * Never pass arbitrary SQL from an HTTP client into this inventory.
 */
export type ReadQuery = {
  id: string;
  screen: string;
  source: string;
  sql: string;
  params: unknown[];
};
export const businessId = 'a0000000-0000-4000-8000-000000000001';
export const ownerId = 'a1000000-0000-4000-8000-000000000001';
export const since = '2026-10-25T12:00:00.000Z';
const tenant = [businessId];
const dated = [businessId, since];
export const mainReadQueries: ReadQuery[] = [
  {
    id: 'profile',
    screen: 'Every workspace screen',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select name,services,zip_codes,timezone,opening_hours,faqs,escalation_phone,assistant_restrictions,quiet_start,quiet_end from public.business_profiles where business_id=$1',
    params: tenant,
  },
  {
    id: 'leads_recent',
    screen: 'Overview, inbox, leads',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select l.id,l.contact_id,l.service,l.status,l.summary,l.created_at,l.updated_at,c.name,c.phone,c.zip_code from public.leads l left join public.contacts c on c.business_id=l.business_id and c.id=l.contact_id where l.business_id=$1 order by l.created_at desc limit 100',
    params: tenant,
  },
  {
    id: 'conversations_recent',
    screen: 'Overview, inbox, leads',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select id,lead_id,contact_id,mode,last_inbound_at,last_outbound_at,created_at,updated_at from public.conversations where business_id=$1 order by updated_at desc limit 100',
    params: tenant,
  },
  {
    id: 'messages_recent',
    screen: 'Overview, inbox, leads',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select id,conversation_id,direction,body,status,author,created_at from public.messages where business_id=$1 order by created_at desc limit 500',
    params: tenant,
  },
  {
    id: 'appointments_upcoming',
    screen: 'Calendar; loaded by every workspace GET',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select id,lead_id,status,start_at,end_at,customer_confirmed_at from public.appointments where business_id=$1 order by start_at limit 100',
    params: tenant,
  },
  {
    id: 'subscription',
    screen: 'Billing; loaded by every workspace GET',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select status,current_period_end,cancel_at_period_end,monthly_price_minor,currency from public.subscriptions where business_id=$1',
    params: tenant,
  },
  {
    id: 'entitlements',
    screen: 'Billing, assistant; loaded by every workspace GET',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select automation_enabled,valid_until,period_start,sms_limit,sms_used,ai_limit,ai_used,overage_behavior from public.entitlements where business_id=$1',
    params: tenant,
  },
  {
    id: 'usage_recent',
    screen: 'Billing; loaded by every workspace GET',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select id,kind,quantity,status,created_at from public.usage_events where business_id=$1 order by created_at desc limit 100',
    params: tenant,
  },
  {
    id: 'eligible_calls_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select count(*) from public.calls where business_id=$1 and recovery_eligible=true and created_at >= $2',
    params: dated,
  },
  {
    id: 'replies_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.messages where business_id=$1 and direction='inbound' and created_at >= $2",
    params: dated,
  },
  {
    id: 'qualified_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.leads where business_id=$1 and status in ('qualified','booked','won') and created_at >= $2",
    params: dated,
  },
  {
    id: 'booked_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.appointments where business_id=$1 and status='confirmed' and created_at >= $2",
    params: dated,
  },
  {
    id: 'notifications_recent',
    screen: 'Every workspace screen bell',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select id,lead_id,type,message,read_at,created_at from public.notifications where business_id=$1 order by created_at desc limit 30',
    params: tenant,
  },
  {
    id: 'all_calls_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select count(*) from public.calls where business_id=$1 and created_at >= $2',
    params: dated,
  },
  {
    id: 'recovery_attempts_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.messages where business_id=$1 and direction='outbound' and idempotency_key like 'recovery:%' and send_intent_at is not null and created_at >= $2",
    params: dated,
  },
  {
    id: 'delivered_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.messages where business_id=$1 and direction='outbound' and status='delivered' and created_at >= $2",
    params: dated,
  },
  {
    id: 'owner_wins_count',
    screen: 'Overview metric',
    source: 'src/app/api/workspace/route.ts',
    sql: "select count(*) from public.leads where business_id=$1 and status='won' and updated_at >= $2",
    params: dated,
  },
  {
    id: 'first_membership',
    screen: 'Workspace bootstrap',
    source: 'src/app/api/workspace/route.ts',
    sql: 'select business_id from public.memberships where user_id=$1 and suspended_at is null order by created_at limit 1',
    params: [ownerId],
  },
  {
    id: 'membership_gate',
    screen: 'Every protected read/write',
    source: 'src/lib/server/authorization.ts',
    sql: 'select role,business_id from public.memberships where business_id=$1 and user_id=$2 and suspended_at is null',
    params: [businessId, ownerId],
  },
  {
    id: 'business_gate',
    screen: 'Every protected read/write',
    source: 'src/lib/server/authorization.ts',
    sql: 'select id,name,timezone,state,suspended_at,verified_at,live_test_passed_at,trial_started_at,trial_ends_at from public.businesses where id=$1',
    params: tenant,
  },
  {
    id: 'phone_status',
    screen: 'Phone settings',
    source: 'src/app/api/phone/route.ts',
    sql: 'select phone,forward_to,destination_verified_at,registration_status,routing_enabled from public.phone_numbers where business_id=$1',
    params: tenant,
  },
  {
    id: 'export_leads',
    screen: 'Owner export',
    source: 'src/app/api/export/route.ts',
    sql: 'select l.id,l.service,l.status,l.summary,l.created_at,c.name,c.phone,c.zip_code from public.leads l left join public.contacts c on c.business_id=l.business_id and c.id=l.contact_id where l.business_id=$1 order by l.created_at desc limit 1000',
    params: tenant,
  },
  {
    id: 'export_messages',
    screen: 'Owner export',
    source: 'src/app/api/export/route.ts',
    sql: 'select id,conversation_id,direction,body,status,author,created_at from public.messages where business_id=$1 order by created_at desc limit 5000',
    params: tenant,
  },
  {
    id: 'export_appointments',
    screen: 'Owner export',
    source: 'src/app/api/export/route.ts',
    sql: 'select id,lead_id,status,start_at,end_at from public.appointments where business_id=$1 order by start_at desc limit 1000',
    params: tenant,
  },
  {
    id: 'export_leads_count',
    screen: 'Owner export exact-count metadata',
    source: 'src/app/api/export/route.ts',
    sql: 'select count(*) from public.leads where business_id=$1',
    params: tenant,
  },
  {
    id: 'export_messages_count',
    screen: 'Owner export exact-count metadata',
    source: 'src/app/api/export/route.ts',
    sql: 'select count(*) from public.messages where business_id=$1',
    params: tenant,
  },
  {
    id: 'export_appointments_count',
    screen: 'Owner export exact-count metadata',
    source: 'src/app/api/export/route.ts',
    sql: 'select count(*) from public.appointments where business_id=$1',
    params: tenant,
  },
  {
    id: 'admin_pending_events',
    screen: 'Admin inspect',
    source: 'src/app/api/admin/route.ts',
    sql: 'select id,topic,attempts,available_at,processed_at from public.outbox where business_id=$1 and processed_at is null order by created_at limit 50',
    params: tenant,
  },
  {
    id: 'admin_attempts',
    screen: 'Admin inspect',
    source: 'src/app/api/admin/route.ts',
    sql: 'select id,status,error_code,created_at from public.job_attempts where business_id=$1 order by created_at desc limit 50',
    params: tenant,
  },
  {
    id: 'worker_ai_daily_budget',
    screen: 'Each AI qualification: platform and tenant daily cost gate',
    source: 'src/worker/qualify.ts',
    sql: "select coalesce(sum(cost_minor) filter(where business_id=$1),0)::text business_cost,coalesce(sum(cost_minor),0)::text platform_cost from public.usage_events where kind='ai' and status<>'released' and created_at >= $2",
    params: [businessId, '2026-11-01T00:00:00.000Z'],
  },
  {
    id: 'worker_sms_daily_budget',
    screen: 'Each outbound SMS: platform daily budget gate',
    source: 'src/worker/dispatch.ts',
    sql: "select coalesce(sum(quantity),0)::text used from public.usage_events where kind='sms' and status<>'released' and created_at >= $1",
    params: ['2026-11-01T00:00:00.000Z'],
  },
];

export function assertReadOnlySelect(sql: string) {
  // Inventory owns every literal. Reject multiple statements, write keywords and
  // side-effecting SELECT functions rather than accepting arbitrary SELECT text.
  if (
    !/^select\s/i.test(sql) ||
    /;|\b(insert|update|delete|merge|call|copy|alter|drop|create|truncate|set_config|nextval|setval|pg_advisory)\b/i.test(
      sql,
    )
  )
    throw new Error('Only an inventory-owned read SELECT may be explained.');
  if (!mainReadQueries.some((query) => query.sql === sql))
    throw new Error('Query is not in the read-only inventory.');
}
