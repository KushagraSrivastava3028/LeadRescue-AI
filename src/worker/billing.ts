import { billingConfig, integrationEnabled } from '../lib/server/providers/config';
import { stripeClient } from '../lib/server/providers/billing';
import { assertPlanPrice, planSettings } from '../lib/server/providers/plan';
import { query, transaction } from '../lib/server/providers/database';

export async function reconcileBilling(businessId: string, eventId?: string): Promise<void> {
  if (!integrationEnabled('BILLING')) return;
  const [local] = await query<{
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
  }>(
    'select provider_customer_id,provider_subscription_id from public.subscriptions where business_id=$1',
    [businessId],
  );
  if (!local?.provider_customer_id) throw new Error('Billing customer unavailable');
  const event = eventId
    ? (
        await query<{ payload: { type: string; created: number }; processed_at: Date | null }>(
          'select payload,processed_at from public.webhook_events where business_id=$1 and id=$2',
          [businessId, eventId],
        )
      )[0]
    : undefined;
  if (event?.processed_at) return;
  const client = stripeClient();
  // Provider fetch happens outside our transaction. The webhook's payload is not used to grant access.
  const candidates = await client.subscriptions.list({
    customer: local.provider_customer_id,
    status: 'all',
    limit: 20,
    expand: ['data.latest_invoice'],
  });
  const configuredPrice = billingConfig().priceId;
  const subscription = candidates.data
    .filter((s) => s.items.data.some((i) => i.price.id === configuredPrice))
    .sort((a, b) => b.created - a.created)[0];
  if (!subscription) throw new Error('No matching provider subscription');
  const settings = planSettings();
  try {
    const item = subscription.items.data[0];
    if (subscription.items.data.length !== 1 || (item.quantity ?? 1) !== 1)
      throw new Error('Unsupported plan quantity');
    assertPlanPrice(await client.prices.retrieve(configuredPrice), configuredPrice, false);
    assertPlanPrice(item.price, configuredPrice, false);
  } catch {
    await transaction(async (db) => {
      await db.query(
        'update public.entitlements set automation_enabled=false,updated_at=now() where business_id=$1',
        [businessId],
      );
      await db.query(
        "update public.businesses set state='automation_paused',updated_at=now() where id=$1",
        [businessId],
      );
      await db.query(
        "insert into public.notifications(business_id,type,message) select $1,'billing_plan_mismatch','Billing plan settings do not match the approved provider price. Automation is paused pending operator review.' where not exists(select 1 from public.notifications where business_id=$1 and type='billing_plan_mismatch' and created_at>now()-interval '1 day')",
        [businessId],
      );
    });
    throw new Error('Approved billing plan mismatch');
  }
  const invoice =
    subscription.latest_invoice && typeof subscription.latest_invoice !== 'string'
      ? subscription.latest_invoice
      : null;
  // A zero-value trial invoice or checkout return never grants paid access.
  const paid =
    subscription.status === 'active' &&
    invoice?.status === 'paid' &&
    invoice.amount_paid > 0 &&
    invoice.currency === 'usd';
  const periodEnd = Math.max(...subscription.items.data.map((i) => i.current_period_end));
  const periodStart = Math.min(...subscription.items.data.map((i) => i.current_period_start));
  const riskEvent =
    event?.payload.type === 'charge.refunded' || event?.payload.type === 'charge.dispute.created';
  await transaction(async (db) => {
    const previous = await db.query<{
      last_event_created_at: Date | null;
      current_period_end: Date | null;
      review_required_at: Date | null;
      status: string;
      automation_hold_at: Date | null;
      entitlement_period_start: Date;
      plan_kind: string;
    }>(
      'select s.last_event_created_at,s.current_period_end,s.review_required_at,s.status,b.automation_hold_at,e.period_start entitlement_period_start,e.plan_kind from public.subscriptions s join public.businesses b on b.id=s.business_id join public.entitlements e on e.business_id=s.business_id where s.business_id=$1 for update of s,b,e',
      [businessId],
    );
    // A scheduled observation is not a provider event timestamp. Advancing this
    // watermark with the app clock could discard a legitimate same-second event.
    const providerCreated = event
      ? new Date(event.payload.created * 1000)
      : (previous.rows[0]?.last_event_created_at ?? null);
    // Risk holds are sticky and must apply even for delayed/out-of-order risk events.
    if (riskEvent) {
      await db.query(
        "update public.subscriptions set review_required_at=coalesce(review_required_at,now()),status='review_required' where business_id=$1",
        [businessId],
      );
      await db.query(
        'update public.entitlements set automation_enabled=false,updated_at=now() where business_id=$1',
        [businessId],
      );
      await db.query(
        "update public.businesses set state='automation_paused',updated_at=now() where id=$1",
        [businessId],
      );
    }
    if (
      event &&
      providerCreated &&
      previous.rows[0]?.last_event_created_at &&
      new Date(previous.rows[0].last_event_created_at) > providerCreated
    ) {
      await db.query(
        'update public.webhook_events set processed_at=now() where business_id=$1 and id=$2',
        [businessId, eventId],
      );
      return;
    }
    const held =
      riskEvent || !!previous.rows[0]?.review_required_at || !!previous.rows[0]?.automation_hold_at;
    await db.query(
      'update public.subscriptions set provider_subscription_id=$2,status=$3,current_period_end=$4,cancel_at_period_end=$5,last_event_created_at=$6,monthly_price_minor=$7,currency=$8,updated_at=now() where business_id=$1',
      [
        businessId,
        subscription.id,
        held ? 'review_required' : subscription.status,
        Number.isFinite(periodEnd) ? new Date(periodEnd * 1000) : null,
        subscription.cancel_at_period_end,
        providerCreated,
        settings.monthlyPriceMinor,
        settings.currency,
      ],
    );
    const active = paid && !held && periodEnd * 1000 > Date.now();
    if (active) {
      const renewed =
        !!previous.rows[0] &&
        Number.isFinite(periodStart) &&
        new Date(previous.rows[0].entitlement_period_start).getTime() < periodStart * 1000;
      const applyPlan = renewed || previous.rows[0]?.plan_kind !== 'paid';
      await db.query(
        "update public.entitlements set automation_enabled=true,valid_until=$2,period_start=case when $4 then $3 else period_start end,sms_used=case when $4 then 0 else sms_used end,ai_used=case when $4 then 0 else ai_used end,sms_limit=case when $4 then $5 else sms_limit end,ai_limit=case when $4 then $6 else ai_limit end,plan_kind='paid',paid_plan_started_at=coalesce(paid_plan_started_at,now()),updated_at=now() where business_id=$1",
        [
          businessId,
          new Date(periodEnd * 1000),
          new Date(periodStart * 1000),
          applyPlan,
          settings.paidSmsLimit,
          settings.paidAiLimit,
        ],
      );
      await db.query(
        "update public.businesses set state='paid_active',updated_at=now() where id=$1 and suspended_at is null",
        [businessId],
      );
    } else {
      const currentTrial = await db.query(
        "select id from public.businesses where id=$1 and state='trial_active' and trial_ends_at>now() and suspended_at is null",
        [businessId],
      );
      if (!currentTrial.rows[0] || held) {
        await db.query(
          'update public.entitlements set automation_enabled=false,updated_at=now() where business_id=$1',
          [businessId],
        );
        await db.query('update public.businesses set state=$2,updated_at=now() where id=$1', [
          businessId,
          subscription.status === 'canceled' ? 'canceled' : 'automation_paused',
        ]);
      }
      if (
        ['past_due', 'unpaid', 'incomplete', 'canceled'].includes(subscription.status) ||
        riskEvent
      )
        await db.query(
          "insert into public.notifications(business_id,type,message) values($1,'billing_attention','Billing requires attention. Automation is paused when entitlements expire; call forwarding and opt-out processing continue.')",
          [businessId],
        );
    }
    if (eventId)
      await db.query(
        'update public.webhook_events set processed_at=now() where business_id=$1 and id=$2',
        [businessId, eventId],
      );
  });
}
