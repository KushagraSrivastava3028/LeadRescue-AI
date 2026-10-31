-- Protected paid-plan snapshot. An ordinary same-period reconciliation cannot
-- reset trial/paid usage or silently mutate already granted paid allowances.
alter table public.entitlements add column plan_kind text not null default 'trial' check(plan_kind in ('trial','paid'));
alter table public.entitlements add column paid_plan_started_at timestamptz;
-- Existing server-verified paid records retain their current-period allowances.
update public.entitlements e set plan_kind='paid',paid_plan_started_at=coalesce(b.updated_at,now()) from public.businesses b where b.id=e.business_id and b.state='paid_active';
