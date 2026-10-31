import { transaction } from '../lib/server/providers/database';
import { integrationEnabled } from '../lib/server/providers/config';

export async function maintenance(): Promise<void> {
  await transaction(async (db) => {
    const lock = await db.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock(749302) locked',
    );
    if (!lock.rows[0].locked) return;
    await db.query(
      'update public.entitlements set automation_enabled=false,updated_at=now() where automation_enabled and valid_until<=now()',
    );
    await db.query(
      "update public.businesses b set state='automation_paused',updated_at=now() from public.entitlements e where e.business_id=b.id and not e.automation_enabled and b.state in ('trial_active','paid_active') and e.valid_until<=now()",
    );
    // Durable, idempotent reminders per day. No customer data leaves the database.
    await db.query(
      "insert into public.notifications(business_id,type,message) select b.id,'trial_reminder','Your trial ends soon. Review your plan in Billing; no charges start without accepted checkout.' from public.businesses b where b.state='trial_active' and b.trial_ends_at>now() and b.trial_ends_at<now()+interval '3 days' and not exists(select 1 from public.notifications n where n.business_id=b.id and n.type='trial_reminder' and n.created_at>now()-interval '24 hours')",
    );
    // Stale submitted intents after a crash are UNKNOWN, never re-dispatched automatically.
    await db.query(
      "update public.messages set status='unknown',error_code='worker_interrupted',updated_at=now() where status='submitted' and provider_id is null and send_intent_at<now()-interval '2 minutes'",
    );
    await db.query(
      'update public.conversations set dispatching_until=null where dispatching_until<now()',
    );
    if (integrationEnabled('BILLING'))
      await db.query(
        "insert into public.outbox(business_id,topic,payload) select s.business_id,'billing.reconcile','{}'::jsonb from public.subscriptions s where s.provider_subscription_id is not null and not exists(select 1 from public.outbox o where o.business_id=s.business_id and o.topic='billing.reconcile' and o.created_at>now()-interval '6 hours')",
      );
    await db.query("delete from private.rate_limits where window_start<now()-interval '2 days'");
  });
}
