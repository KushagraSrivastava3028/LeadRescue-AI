-- Provider number purchases use an intent ledger. An unknown outcome blocks
-- repeat purchases until an operator reconciles the provider's inventory.
create unique index phone_numbers_one_per_business_idx on public.phone_numbers(business_id);
create table private.phone_provisioning_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','complete','unknown')),
  provider_number_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id)
);
alter table private.phone_provisioning_operations enable row level security;
revoke all on private.phone_provisioning_operations from public,anon,authenticated;
grant all on private.phone_provisioning_operations to service_role;

create function public.begin_phone_provisioning(p_business_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  perform 1 from public.businesses where id=p_business_id and suspended_at is null and state<>'canceled' for update;
  if not found or exists(select 1 from public.phone_numbers where business_id=p_business_id) or exists(select 1 from private.phone_provisioning_operations where business_id=p_business_id) or not exists(select 1 from public.provider_accounts where business_id=p_business_id and provider='twilio') then raise exception 'Phone provisioning unavailable; reconcile existing operations before retrying' using errcode='23514'; end if;
  insert into private.phone_provisioning_operations(business_id) values(p_business_id) returning id into v_id;
  insert into public.audit_logs(business_id,action,resource_id) values(p_business_id,'phone.provisioning_started',v_id);
  return v_id;
end $$;

create function public.finish_phone_provisioning(p_operation_id uuid,p_business_id uuid,p_provider_account_id uuid,p_sid text,p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_operation private.phone_provisioning_operations; begin
  perform 1 from public.businesses where id=p_business_id for update;
  select * into v_operation from private.phone_provisioning_operations where business_id=p_business_id and id=p_operation_id for update;
  if not found then raise exception 'Operation unavailable' using errcode='42501'; end if;
  if v_operation.state='complete' then
    if v_operation.provider_number_id=p_sid and exists(select 1 from public.phone_numbers where business_id=p_business_id and provider_id=p_sid and phone=p_phone and provider_account_id=p_provider_account_id) then return; end if;
    raise exception 'Conflicting provisioning outcome' using errcode='23514';
  end if;
  if p_sid !~ '^PN[a-fA-F0-9]{32}$' or p_phone !~ '^\+1[2-9][0-9]{9}$' or not exists(select 1 from public.provider_accounts where business_id=p_business_id and id=p_provider_account_id and provider='twilio') then raise exception 'Provider number rejected' using errcode='22023'; end if;
  -- An operator may reconcile an unknown purchase using the provider's proven ID.
  insert into public.phone_numbers(business_id,provider_account_id,phone,provider_id) values(p_business_id,p_provider_account_id,p_phone,p_sid);
  update private.phone_provisioning_operations set state='complete',provider_number_id=p_sid,updated_at=now() where business_id=p_business_id and id=p_operation_id;
  update public.businesses set state='phone_pending',updated_at=now() where id=p_business_id and state='account_created';
  insert into public.audit_logs(business_id,action,resource_id) values(p_business_id,'phone.provisioning_completed',p_operation_id);
end $$;

create function public.mark_phone_provisioning_unknown(p_operation_id uuid,p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.phone_provisioning_operations set state='unknown',updated_at=now() where business_id=p_business_id and id=p_operation_id and state='pending';
  if found then insert into public.audit_logs(business_id,action,resource_id) values(p_business_id,'phone.provisioning_unknown',p_operation_id); end if;
end $$;
revoke all on function public.begin_phone_provisioning(uuid),public.finish_phone_provisioning(uuid,uuid,uuid,text,text),public.mark_phone_provisioning_unknown(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_phone_provisioning(uuid),public.finish_phone_provisioning(uuid,uuid,uuid,text,text),public.mark_phone_provisioning_unknown(uuid,uuid) to service_role;

alter table public.appointments add column customer_confirmation_hash text;
alter table public.appointments add constraint appointments_confirmation_hash_check check (customer_confirmation_hash is null or customer_confirmation_hash ~ '^[a-f0-9]{64}$');

create function public.request_appointment(p_business_id uuid,p_lead_id uuid,p_start_at timestamptz,p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile public.business_profiles; v_local_start timestamp; v_local_end timestamp; v_hours jsonb; v_id uuid; begin
  if not private.has_membership(p_business_id,array['owner','staff']) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_start_at is null or p_note is null or p_start_at<=now() or p_start_at>now()+interval '90 days' or length(trim(p_note)) not between 1 and 1000 then raise exception 'Invalid inspection request' using errcode='22023'; end if;
  if not exists(select 1 from public.leads where business_id=p_business_id and id=p_lead_id) then raise exception 'Lead unavailable' using errcode='42501'; end if;
  select * into v_profile from public.business_profiles where business_id=p_business_id;
  v_local_start:=p_start_at at time zone v_profile.timezone;
  v_local_end:=(p_start_at+interval '60 minutes') at time zone v_profile.timezone;
  v_hours:=v_profile.opening_hours->lower(to_char(v_local_start,'Dy'));
  if v_hours is null or v_hours->>'enabled'='false' or v_hours->>'open' is null or v_hours->>'close' is null or v_local_start::date<>v_local_end::date or v_local_start::time<((v_hours->>'open')::time+interval '15 minutes')::time or v_local_end::time>((v_hours->>'close')::time-interval '15 minutes')::time then raise exception 'Inspection is outside configured service hours and buffer' using errcode='23514'; end if;
  insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key) values(p_business_id,p_lead_id,p_start_at,p_start_at+interval '60 minutes','requested',gen_random_uuid()::text) returning id into v_id;
  insert into public.notifications(business_id,lead_id,type,message) values(p_business_id,p_lead_id,'inspection_requested',trim(p_note));
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'appointment.requested',v_id);
  return v_id;
end $$;

create function public.confirm_appointment(p_business_id uuid,p_appointment_id uuid,p_evidence_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_appointment public.appointments; v_connection_id uuid; begin
  if p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$' then raise exception 'Confirmation evidence required' using errcode='22023'; end if;
  select * into v_appointment from public.appointments where business_id=p_business_id and id=p_appointment_id for update;
  if not found or v_appointment.start_at<=now() then raise exception 'Appointment request unavailable' using errcode='42501'; end if;
  if v_appointment.customer_confirmed_at is not null then return v_appointment.status; end if;
  if v_appointment.status<>'requested' then raise exception 'Appointment request unavailable' using errcode='23514'; end if;
  select id into v_connection_id from public.calendar_connections where business_id=p_business_id and revoked_at is null order by created_at limit 1;
  update public.appointments set customer_confirmed_at=now(),customer_confirmation_hash=p_evidence_hash,calendar_connection_id=v_connection_id,status=case when v_connection_id is not null then 'pending' else 'requested' end where business_id=p_business_id and id=p_appointment_id;
  if v_connection_id is not null then
    insert into public.outbox(business_id,topic,payload) values(p_business_id,'calendar.book',jsonb_build_object('appointmentId',p_appointment_id));
  else
    insert into public.notifications(business_id,lead_id,type,message) values(p_business_id,v_appointment.lead_id,'booking_callback','The customer confirmed an inspection request. A team member must arrange it because no calendar is connected.');
  end if;
  insert into public.audit_logs(business_id,action,resource_id) values(p_business_id,'appointment.customer_confirmed',p_appointment_id);
  return case when v_connection_id is not null then 'pending' else 'requested' end;
end $$;
revoke all on function public.request_appointment(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.request_appointment(uuid,uuid,timestamptz,text) to authenticated;
revoke all on function public.confirm_appointment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_appointment(uuid,uuid,text) to service_role;
