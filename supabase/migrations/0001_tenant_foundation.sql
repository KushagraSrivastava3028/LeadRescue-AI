-- LeadRescue tenant foundation. Apply through Supabase migrations as an operator.
-- All timestamps are UTC; local scheduling uses the tenant's IANA timezone.
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
revoke create on schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  timezone text not null default 'America/Chicago',
  state text not null default 'account_created' check (state in ('account_created','phone_pending','messaging_pending','ready_for_test','trial_active','paid_active','automation_paused','canceled')),
  verified_at timestamptz,
  live_test_passed_at timestamptz,
  suspended_at timestamptz,
  automation_hold_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at is null or trial_ends_at > trial_started_at)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','staff','viewer')),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id,user_id), unique (business_id,id)
);
create index memberships_user_idx on public.memberships(user_id,business_id);

create table public.business_profiles (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  name text not null,
  services text[] not null default array['Roof repair','Roof inspection','Roof replacement','Storm damage'],
  zip_codes text[] not null default '{}',
  timezone text not null default 'America/Chicago',
  opening_hours jsonb not null default '{"mon":{"open":"08:00","close":"17:00"},"tue":{"open":"08:00","close":"17:00"},"wed":{"open":"08:00","close":"17:00"},"thu":{"open":"08:00","close":"17:00"},"fri":{"open":"08:00","close":"17:00"}}',
  faqs jsonb not null default '[]',
  escalation_phone text check (escalation_phone is null or escalation_phone ~ '^\+1[2-9][0-9]{9}$'),
  assistant_restrictions text[] not null default array['Never quote prices','Never promise emergency response','Request confirmation before booking'],
  quiet_start smallint not null default 20 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 8 check (quiet_end between 0 and 23),
  updated_at timestamptz not null default now(),
  check (array_length(services,1) <= 30),
  check (array_length(zip_codes,1) <= 500),
  check (jsonb_typeof(opening_hours) = 'object'),
  check (jsonb_typeof(faqs) = 'array')
);

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('twilio','stripe','google')),
  account_sid text not null,
  token_ciphertext text,
  key_version text,
  created_at timestamptz not null default now(),
  unique (provider,account_sid), unique (business_id,id)
);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_account_id uuid not null,
  phone text not null unique check (phone ~ '^\+1[2-9][0-9]{9}$'),
  provider_id text not null unique,
  forward_to text check (forward_to is null or forward_to ~ '^\+1[2-9][0-9]{9}$'),
  destination_verified_at timestamptz,
  registration_status text not null default 'pending' check (registration_status in ('pending','approved','rejected')),
  routing_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,provider_account_id) references public.provider_accounts(business_id,id),
  check (forward_to is distinct from phone),
  check (not routing_enabled or (destination_verified_at is not null and forward_to is not null))
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_number_id uuid,
  call_sid text not null unique,
  from_phone text not null,
  to_phone text not null,
  status text not null default 'initiated',
  recovery_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,phone_number_id) references public.phone_numbers(business_id,id)
);
create index calls_business_created_idx on public.calls(business_id,created_at desc);
create table public.call_legs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  call_id uuid not null,
  call_sid text not null unique,
  parent_call_sid text not null,
  outcome text not null,
  sequence_number integer not null default 0,
  duration_seconds integer check (duration_seconds >= 0),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,call_id) references public.calls(business_id,id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  name text,
  zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$'),
  created_at timestamptz not null default now(),
  unique (business_id,phone), unique (business_id,id)
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null,
  call_id uuid,
  service text not null default 'Roof enquiry',
  status text not null default 'new' check (status in ('new','ai_replying','needs_callback','qualified','booked','won','lost')),
  summary text not null default '',
  won_confirmed_at timestamptz,
  won_confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id),
  foreign key (business_id,call_id) references public.calls(business_id,id)
);
create index leads_business_created_idx on public.leads(business_id,created_at desc);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null,
  contact_id uuid not null,
  mode text not null default 'ai' check (mode in ('ai','human')),
  ai_turns integer not null default 0 check (ai_turns >= 0),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  dispatching_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id), unique (business_id,lead_id),
  foreign key (business_id,lead_id) references public.leads(business_id,id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null,
  contact_id uuid not null,
  provider_id text unique,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null check (length(body) between 1 and 1600),
  status text not null default 'pending' check (status in ('pending','submitted','sent','delivered','undelivered','failed','unknown','received','suppressed')),
  author text not null default 'ai' check (author in ('ai','human','customer','system')),
  idempotency_key text,
  send_intent_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id), unique (business_id,idempotency_key),
  foreign key (business_id,conversation_id) references public.conversations(business_id,id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id)
);
create index messages_conversation_created_idx on public.messages(business_id,conversation_id,created_at);
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null,
  sender_phone text not null,
  scope text not null default 'service_recovery' check (scope in ('service_recovery','conversation_reply')),
  source text not null check (source in ('signed_form','recorded_authorization','inbound_customer_request','operator_verified')),
  policy_version text not null,
  evidence_reference text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id)
);
create index consents_contact_idx on public.consents(business_id,contact_id,granted_at desc);
create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null,
  reason text not null,
  provider_synced boolean not null default false,
  suppressed_at timestamptz not null default now(),
  cleared_at timestamptz,
  clearance_evidence text,
  unique (business_id,id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id),
  check (cleared_at is null or clearance_evidence is not null)
);
create unique index suppressions_active_idx on public.suppressions(business_id,contact_id) where cleared_at is null;

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  calendar_id text not null,
  refresh_token_ciphertext text not null,
  key_version text not null,
  scopes text[] not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id,id), unique (business_id,provider)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null,
  calendar_connection_id uuid,
  provider_id text,
  status text not null default 'requested' check (status in ('requested','pending','confirmed','canceled','failed','unknown')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  customer_confirmed_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id,id), unique (business_id,idempotency_key),
  foreign key (business_id,lead_id) references public.leads(business_id,id),
  foreign key (business_id,calendar_connection_id) references public.calendar_connections(business_id,id),
  check (end_at > start_at),
  check (status <> 'confirmed' or (provider_id is not null and customer_confirmed_at is not null))
);
create index appointments_business_time_idx on public.appointments(business_id,start_at,end_at);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider,event_key), unique (business_id,id)
);
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  topic text not null,
  payload jsonb not null,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (business_id,id)
);
create index outbox_pending_idx on public.outbox(available_at) where processed_at is null;
create table public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  outbox_id uuid,
  job_id text not null,
  status text not null,
  error_code text,
  created_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,outbox_id) references public.outbox(business_id,id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text unique,
  provider_subscription_id text unique,
  status text not null default 'inactive',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  monthly_price_minor integer not null default 29900 check (monthly_price_minor >= 0),
  currency text not null default 'usd',
  pricing_accepted_at timestamptz,
  pricing_policy_version text,
  last_event_created_at timestamptz,
  review_required_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id), unique (business_id,id)
);
create table public.entitlements (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  automation_enabled boolean not null default false,
  valid_until timestamptz,
  period_start timestamptz not null default now(),
  sms_limit integer not null default 100 check (sms_limit between 0 and 100000),
  sms_used integer not null default 0 check (sms_used >= 0),
  ai_limit integer not null default 100 check (ai_limit between 0 and 100000),
  ai_used integer not null default 0 check (ai_used >= 0),
  daily_ai_cost_limit_minor integer not null default 500 check (daily_ai_cost_limit_minor >= 0),
  overage_behavior text not null default 'pause' check (overage_behavior = 'pause'),
  updated_at timestamptz not null default now()
);
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('sms','ai','appointment')),
  quantity integer not null default 1 check (quantity > 0),
  cost_minor integer not null default 0 check (cost_minor >= 0),
  status text not null default 'reserved' check (status in ('reserved','settled','released','unknown')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id,id), unique (business_id,idempotency_key)
);
create index usage_events_period_idx on public.usage_events(business_id,kind,created_at);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  resource_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (business_id,id)
);
create index audit_logs_business_created_idx on public.audit_logs(business_id,created_at desc);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid,
  type text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id,id),
  foreign key (business_id,lead_id) references public.leads(business_id,id)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role text not null check (role in ('staff','viewer')),
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null default now() + interval '48 hours',
  consumed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id,id)
);
create table public.trial_registry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete restrict,
  verified_identity_hash text not null unique,
  started_at timestamptz not null default now(),
  override_reason text,
  unique (business_id,id)
);
-- Platform-owned records have no business_id because they confer no tenant access.
create table private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('operator','auditor')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null check (count >= 0)
);

-- Membership predicates run under a pinned owner context and never invoke their
-- own RLS policy recursively. No client-supplied JWT role or metadata is trusted.
-- Supabase JWTs may otherwise remain usable after logout until token expiry.
-- The provider session table is the authority for explicit session revocation.
create function private.active_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid());
$$;
revoke all on function private.active_session() from public,anon;
grant execute on function private.active_session() to authenticated,service_role;
create function public.check_active_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.active_session();
$$;
revoke all on function public.check_active_session() from public,anon;
grant execute on function public.check_active_session() to authenticated;

create function private.has_membership(p_business_id uuid, p_roles text[] default array['owner','staff','viewer'])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.active_session() and exists (
    select 1 from public.memberships m join public.businesses b on b.id=m.business_id
    join auth.users u on u.id=m.user_id
    where m.business_id=p_business_id and m.user_id=(select auth.uid())
      and m.role=any(p_roles) and m.suspended_at is null and b.suspended_at is null
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
  );
$$;
revoke all on function private.has_membership(uuid,text[]) from public,anon;
grant execute on function private.has_membership(uuid,text[]) to authenticated,service_role;

-- Start by revoking the Supabase default grants. Every exposed table uses RLS.
do $$ declare t text; begin
  foreach t in array array['businesses','memberships','business_profiles','provider_accounts','phone_numbers','calls','call_legs','contacts','leads','conversations','messages','consents','suppressions','calendar_connections','appointments','webhook_events','outbox','job_attempts','subscriptions','entitlements','usage_events','audit_logs','notifications','invitations','trial_registry'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;
alter table private.platform_admins enable row level security;
alter table private.rate_limits enable row level security;
revoke all on all tables in schema private from public,anon,authenticated;
grant all on all tables in schema private to service_role;

grant select on public.businesses,public.memberships,public.business_profiles,public.phone_numbers,public.calls,public.call_legs,public.contacts,public.leads,public.conversations,public.messages,public.appointments,public.subscriptions,public.entitlements,public.usage_events,public.notifications to authenticated;
create policy business_read on public.businesses for select to authenticated using (private.has_membership(id));
do $$ declare t text; begin
  foreach t in array array['memberships','business_profiles','phone_numbers','calls','call_legs','contacts','leads','conversations','messages','appointments','subscriptions','entitlements','usage_events','notifications'] loop
    execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_membership(business_id))',t);
  end loop;
end $$;
grant select on public.audit_logs to authenticated;
create policy audit_owner_read on public.audit_logs for select to authenticated using (private.has_membership(business_id,array['owner']));
-- Column grants protect routing, verification, ownership and billing against mass assignment.
grant update (name,services,zip_codes,timezone,opening_hours,faqs,escalation_phone,assistant_restrictions) on public.business_profiles to authenticated;
create policy profile_owner_update on public.business_profiles for update to authenticated using (private.has_membership(business_id,array['owner'])) with check (private.has_membership(business_id,array['owner']));
grant update (read_at) on public.notifications to authenticated;
create policy notification_staff_update on public.notifications for update to authenticated using (private.has_membership(business_id,array['owner','staff'])) with check (private.has_membership(business_id,array['owner','staff']));
-- No user INSERT/DELETE grants. Bounded SECURITY DEFINER functions below handle
-- business creation, invitations, message intents, and membership lifecycle.

create function private.guard_last_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role='owner' and old.suspended_at is null and (tg_op='DELETE' or new.role<>'owner' or new.suspended_at is not null) then
    perform 1 from public.businesses where id=old.business_id for update;
    if not exists(select 1 from public.memberships where business_id=old.business_id and role='owner' and suspended_at is null and id<>old.id) then
      raise exception 'The last owner cannot be removed' using errcode='23514';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_last_owner before update or delete on public.memberships for each row execute function private.guard_last_owner();
revoke all on function private.guard_last_owner() from public,anon,authenticated;

create function public.create_business(p_name text,p_timezone text default 'America/Chicago',p_zip_codes text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := auth.uid(); begin
  if v_user is null or not private.active_session() or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null and (banned_until is null or banned_until<now())) then raise exception 'Verified account required' using errcode='42501'; end if;
  if length(trim(p_name)) not between 2 and 120 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) or coalesce(array_length(p_zip_codes,1),0)>500 or exists(select 1 from unnest(p_zip_codes) z where z !~ '^[0-9]{5}$') then raise exception 'Invalid business details' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,0));
  if (select count(*) from public.memberships where user_id=v_user)>=3 then raise exception 'Business limit reached' using errcode='23514'; end if;
  insert into public.businesses(name,timezone) values(trim(p_name),p_timezone) returning id into v_id;
  insert into public.memberships(business_id,user_id,role) values(v_id,v_user,'owner');
  insert into public.business_profiles(business_id,name,timezone,zip_codes) values(v_id,trim(p_name),p_timezone,p_zip_codes);
  insert into public.entitlements(business_id) values(v_id);
  insert into public.subscriptions(business_id) values(v_id);
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(v_id,v_user,'business.created',v_id);
  return v_id;
end $$;

create function public.take_over_conversation(p_business_id uuid,p_conversation_id uuid,p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_conversation public.conversations; begin
  if not private.has_membership(p_business_id,array['owner','staff']) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_mode not in ('ai','human') then raise exception 'Invalid mode' using errcode='22023'; end if;
  select * into v_conversation from public.conversations where business_id=p_business_id and id=p_conversation_id for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  if v_conversation.dispatching_until>now() then raise exception 'A message is dispatching; retry shortly' using errcode='55P03'; end if;
  update public.conversations set mode=p_mode,updated_at=now() where business_id=p_business_id and id=p_conversation_id;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'conversation.mode.'||p_mode,p_conversation_id);
end $$;

create function public.enqueue_manual_message(p_business_id uuid,p_conversation_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_conversation public.conversations; v_id uuid; begin
  if not private.has_membership(p_business_id,array['owner','staff']) then raise exception 'Access denied' using errcode='42501'; end if;
  if length(trim(p_body)) not between 1 and 1600 then raise exception 'Invalid message' using errcode='22023'; end if;
  select * into v_conversation from public.conversations where business_id=p_business_id and id=p_conversation_id for update;
  if not found or v_conversation.mode<>'human' then raise exception 'Take over before replying' using errcode='42501'; end if;
  insert into public.messages(business_id,conversation_id,contact_id,direction,body,author,status) values(p_business_id,p_conversation_id,v_conversation.contact_id,'outbound',trim(p_body),'human','pending') returning id into v_id;
  insert into public.outbox(business_id,topic,payload) values(p_business_id,'sms.send',jsonb_build_object('messageId',v_id,'conversationId',p_conversation_id,'manual',true));
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'message.enqueued',v_id);
  return v_id;
end $$;

create function public.update_lead(p_business_id uuid,p_lead_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_membership(p_business_id,array['owner','staff']) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_status not in ('new','needs_callback','qualified','won','lost') then raise exception 'Invalid manual status' using errcode='22023'; end if;
  if p_status='won' and not private.has_membership(p_business_id,array['owner']) then raise exception 'Only an owner can confirm a won job' using errcode='42501'; end if;
  update public.leads set status=p_status,updated_at=now(),won_confirmed_at=case when p_status='won' then now() else null end,won_confirmed_by=case when p_status='won' then auth.uid() else null end where business_id=p_business_id and id=p_lead_id;
  if not found then raise exception 'Lead unavailable' using errcode='42501'; end if;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'lead.status.'||p_status,p_lead_id);
end $$;

create function public.create_invitation(p_business_id uuid,p_email text,p_role text,p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  if not private.has_membership(p_business_id,array['owner']) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_role not in ('staff','viewer') or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
  insert into public.invitations(business_id,email,role,token_hash,created_by) values(p_business_id,lower(trim(p_email)),p_role,p_token_hash,auth.uid()) returning id into v_id;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'membership.invited',v_id);
  return v_id;
end $$;
create function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.invitations; v_email text; begin
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null and (banned_until is null or banned_until<now());
  if not found or not private.active_session() or length(p_token) not between 32 and 256 then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  select * into v_invite from public.invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and consumed_at is null and expires_at>now() for update;
  if not found or v_invite.email<>v_email then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  insert into public.memberships(business_id,user_id,role) values(v_invite.business_id,auth.uid(),v_invite.role) on conflict (business_id,user_id) do nothing;
  update public.invitations set consumed_at=now() where id=v_invite.id;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(v_invite.business_id,auth.uid(),'membership.joined',v_invite.id);
  return v_invite.business_id;
end $$;

-- Service-only webhook ingestion commits event and outbox atomically.
create function public.ingest_webhook(p_business_id uuid,p_provider text,p_event_key text,p_payload jsonb,p_topic text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  insert into public.webhook_events(business_id,provider,event_key,payload) values(p_business_id,p_provider,p_event_key,p_payload) on conflict(provider,event_key) do nothing returning id into v_id;
  if v_id is not null then insert into public.outbox(business_id,topic,payload) values(p_business_id,p_topic,jsonb_build_object('eventId',v_id)); end if;
  return v_id;
end $$;

create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row private.rate_limits; v_window timestamptz; begin
  if length(p_key) not between 1 and 200 or p_limit not between 1 and 100000 or p_window_seconds not between 1 and 86400 then raise exception 'Invalid limiter' using errcode='22023'; end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp())/p_window_seconds)*p_window_seconds);
  insert into private.rate_limits(key,window_start,count) values(p_key,v_window,1)
  on conflict(key) do update set count=case when private.rate_limits.window_start=excluded.window_start then private.rate_limits.count+1 else 1 end,window_start=excluded.window_start returning * into v_row;
  return jsonb_build_object('allowed',v_row.count<=p_limit,'remaining',greatest(0,p_limit-v_row.count),'retry_after',greatest(1,ceil(extract(epoch from v_row.window_start+make_interval(secs=>p_window_seconds)-clock_timestamp()))));
end $$;

create function public.reserve_usage(p_business_id uuid,p_kind text,p_idempotency_key text,p_quantity integer default 1)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.entitlements; v_id uuid; begin
  if p_kind not in ('sms','ai','appointment') or p_quantity not between 1 and 100 or length(p_idempotency_key)>200 then raise exception 'Invalid usage' using errcode='22023'; end if;
  select * into v_e from public.entitlements where business_id=p_business_id for update;
  select id into v_id from public.usage_events where business_id=p_business_id and idempotency_key=p_idempotency_key;
  if v_id is not null then return v_id; end if;
  if v_e.business_id is null or not v_e.automation_enabled or v_e.valid_until is null or v_e.valid_until<=now() or exists(select 1 from public.businesses where id=p_business_id and (suspended_at is not null or automation_hold_at is not null or state in ('canceled','automation_paused'))) or exists(select 1 from public.subscriptions where business_id=p_business_id and review_required_at is not null) then raise exception 'Automation unavailable' using errcode='42501'; end if;
  if (p_kind='sms' and v_e.sms_used+p_quantity>v_e.sms_limit) or (p_kind='ai' and v_e.ai_used+p_quantity>v_e.ai_limit) then raise exception 'Usage cap reached' using errcode='23514'; end if;
  insert into public.usage_events(business_id,kind,quantity,idempotency_key) values(p_business_id,p_kind,p_quantity,p_idempotency_key) returning id into v_id;
  update public.entitlements set sms_used=sms_used+case when p_kind='sms' then p_quantity else 0 end,ai_used=ai_used+case when p_kind='ai' then p_quantity else 0 end,updated_at=now() where business_id=p_business_id;
  return v_id;
end $$;

create function public.activate_trial(p_business_id uuid,p_verified_identity_hash text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz; v_b public.businesses; begin
  select * into v_b from public.businesses where id=p_business_id for update;
  if not found or v_b.verified_at is null or v_b.live_test_passed_at is null or v_b.suspended_at is not null or v_b.automation_hold_at is not null or v_b.trial_started_at is not null or p_verified_identity_hash !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.phone_numbers where business_id=p_business_id and destination_verified_at is not null and routing_enabled and registration_status='approved') then raise exception 'Activation prerequisites incomplete' using errcode='42501'; end if;
  insert into public.trial_registry(business_id,verified_identity_hash) values(p_business_id,p_verified_identity_hash);
  v_end:=now()+interval '14 days';
  update public.businesses set state='trial_active',trial_started_at=now(),trial_ends_at=v_end,updated_at=now() where id=p_business_id;
  update public.entitlements set automation_enabled=true,valid_until=v_end,period_start=now(),sms_used=0,ai_used=0,updated_at=now() where business_id=p_business_id;
  insert into public.audit_logs(business_id,action,resource_id) values(p_business_id,'trial.activated',p_business_id);
  return v_end;
end $$;

create function public.check_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.active_session() and coalesce((auth.jwt()->>'aal')='aal2',false) and exists(select 1 from private.platform_admins p join auth.users u on u.id=p.user_id where p.user_id=auth.uid() and p.revoked_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<now()));
$$;

-- Never retain PostgreSQL's default PUBLIC EXECUTE for privileged routines.
revoke all on function public.create_business(text,text,text[]), public.take_over_conversation(uuid,uuid,text), public.enqueue_manual_message(uuid,uuid,text), public.update_lead(uuid,uuid,text), public.create_invitation(uuid,text,text,text), public.accept_invitation(text), public.check_platform_admin() from public,anon;
grant execute on function public.create_business(text,text,text[]), public.take_over_conversation(uuid,uuid,text), public.enqueue_manual_message(uuid,uuid,text), public.update_lead(uuid,uuid,text), public.create_invitation(uuid,text,text,text), public.accept_invitation(text), public.check_platform_admin() to authenticated;
revoke all on function public.ingest_webhook(uuid,text,text,jsonb,text), public.consume_rate_limit(text,integer,integer), public.reserve_usage(uuid,text,text,integer), public.activate_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.ingest_webhook(uuid,text,text,jsonb,text), public.consume_rate_limit(text,integer,integer), public.reserve_usage(uuid,text,text,integer), public.activate_trial(uuid,text) to service_role;
alter default privileges in schema private revoke all on tables from public,anon,authenticated;
alter default privileges in schema private revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;

