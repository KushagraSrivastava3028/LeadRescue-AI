-- Bounded settings and account operations; no direct membership write grants.
create function private.validate_profile() returns trigger language plpgsql set search_path = '' as $$
begin
  if length(trim(new.name)) not between 2 and 120
     or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone)
     or coalesce(array_length(new.services,1),0)>30
     or exists(select 1 from unnest(new.services) s where length(s) not between 1 and 100)
     or exists(select 1 from unnest(new.zip_codes) z where z !~ '^[0-9]{5}$')
     or coalesce(array_length(new.assistant_restrictions,1),0)>30
     or exists(select 1 from unnest(new.assistant_restrictions) r where length(r)>500)
     or pg_catalog.pg_column_size(new.faqs)>32768
     or pg_catalog.pg_column_size(new.opening_hours)>8192 then
    raise exception 'Invalid profile settings' using errcode='22023';
  end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function private.validate_profile() from public,anon,authenticated;
create trigger validate_business_profile before insert or update on public.business_profiles for each row execute function private.validate_profile();

create function private.audit_profile_update() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.businesses set name=new.name,timezone=new.timezone,updated_at=now() where id=new.business_id;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(new.business_id,auth.uid(),'business.profile_updated',new.business_id);
  return new;
end $$;
revoke all on function private.audit_profile_update() from public,anon,authenticated;
create trigger audit_business_profile after update on public.business_profiles for each row execute function private.audit_profile_update();

create function public.remove_member(p_business_id uuid,p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_membership(p_business_id,array['owner']) then raise exception 'Access denied' using errcode='42501'; end if;
  perform 1 from public.businesses where id=p_business_id for update;
  delete from public.memberships where business_id=p_business_id and id=p_membership_id;
  if not found then raise exception 'Membership unavailable' using errcode='42501'; end if;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'membership.removed',p_membership_id);
end $$;
revoke all on function public.remove_member(uuid,uuid) from public,anon;
grant execute on function public.remove_member(uuid,uuid) to authenticated;

create function public.persist_webhook(p_business_id uuid,p_provider text,p_event_key text,p_payload jsonb,p_topic text)
returns uuid language sql security definer set search_path = '' as $$
  select public.ingest_webhook(p_business_id,p_provider,p_event_key,p_payload,p_topic);
$$;
revoke all on function public.persist_webhook(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_webhook(uuid,text,text,jsonb,text) to service_role;

-- Support actions record tenant ID and actor, require server-verified aal2 and a
-- separately bootstrapped platform operator; contractor owners are never admins.
create function public.admin_pause_automation(p_business_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.check_platform_admin() or not exists(select 1 from private.platform_admins where user_id=auth.uid() and role='operator' and revoked_at is null) then raise exception 'Access denied' using errcode='42501'; end if;
  if length(trim(p_reason)) not between 10 and 500 then raise exception 'Support reason required' using errcode='22023'; end if;
  update public.entitlements set automation_enabled=false,updated_at=now() where business_id=p_business_id;
  if not found then raise exception 'Business unavailable' using errcode='42501'; end if;
  update public.businesses set state='automation_paused',automation_hold_at=now(),updated_at=now() where id=p_business_id;
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id,metadata) values(p_business_id,auth.uid(),'admin.automation_paused',p_business_id,jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.admin_pause_automation(uuid,text) from public,anon;
grant execute on function public.admin_pause_automation(uuid,text) to authenticated;

create function public.activate_trial(p_business_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_destination text; begin
  if not private.has_membership(p_business_id,array['owner']) then raise exception 'Access denied' using errcode='42501'; end if;
  -- Derive trial identity from a server-verified destination, never a browser flag.
  -- Operators must verify that this destination represents the same business.
  select forward_to into v_destination from public.phone_numbers where business_id=p_business_id and destination_verified_at is not null and routing_enabled and registration_status='approved' order by created_at limit 1;
  if v_destination is null then raise exception 'Activation prerequisites incomplete' using errcode='42501'; end if;
  return public.activate_trial(p_business_id,encode(extensions.digest(v_destination,'sha256'),'hex'));
end $$;
revoke all on function public.activate_trial(uuid) from public,anon;
grant execute on function public.activate_trial(uuid) to authenticated;

create function public.create_callback(p_business_id uuid,p_lead_id uuid,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_membership(p_business_id,array['owner','staff']) then raise exception 'Access denied' using errcode='42501'; end if;
  if length(trim(p_note)) not between 1 and 1000 then raise exception 'Invalid callback note' using errcode='22023'; end if;
  update public.leads set status='needs_callback',updated_at=now() where business_id=p_business_id and id=p_lead_id;
  if not found then raise exception 'Lead unavailable' using errcode='42501'; end if;
  insert into public.notifications(business_id,lead_id,type,message) values(p_business_id,p_lead_id,'callback_requested',trim(p_note));
  insert into public.audit_logs(business_id,actor_user_id,action,resource_id) values(p_business_id,auth.uid(),'callback.requested',p_lead_id);
end $$;
revoke all on function public.create_callback(uuid,uuid,text) from public,anon;
grant execute on function public.create_callback(uuid,uuid,text) to authenticated;

-- Rotate only through an operator process. No browser API may set verification,
-- provider identifiers, encrypted token fields, plan status, or trial timestamps.
comment on table public.consents is 'A call alone creates no consent. Evidence must follow the provider/legal-approved disclosure and re-opt-in process.';
comment on table public.webhook_events is 'Only signature-verified events mapped through trusted provider account and number records may be persisted. Payload retention: operator-configured.';
comment on table public.messages is 'Unknown send outcomes must reconcile provider acceptance before any retry. Provider callbacks are authoritative for delivery.';
comment on table private.platform_admins is 'Restricted SQL bootstrap only; never public signup. All admin routines require verified aal2.';
