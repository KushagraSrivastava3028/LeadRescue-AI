-- Public Supabase RPCs remain reachable with a valid provider user token.
-- Enforce mutation limits inside the database as well as the Next.js gateway.
create function private.enforce_rpc_rate(p_action text,p_business_id uuid,p_limit integer,p_window_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_bucket jsonb; begin
  if auth.uid() is null or not private.active_session() then raise exception 'Active account required' using errcode='42501'; end if;
  v_bucket:=public.consume_rate_limit('rpc:'||p_action||':'||auth.uid()::text||':'||coalesce(p_business_id::text,'account'),p_limit,p_window_seconds);
  if not (v_bucket->>'allowed')::boolean then raise exception 'Mutation rate limit exceeded' using errcode='PT429',detail='Retry after the current rate window.'; end if;
end $$;
revoke all on function private.enforce_rpc_rate(text,uuid,integer,integer) from public,anon,authenticated;

-- Triggers also cover direct PostgREST column updates and direct RPC calls.
-- The limits are intentionally separate from gateway keys; neither boundary can
-- be bypassed by skipping the other. Workers have no auth.uid() and are scoped
-- by explicit business IDs and their own queue/budget/admission limits.
create function private.throttle_tenant_mutation() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_business_id uuid; v_action text; v_limit integer; v_seconds integer; begin
  if auth.uid() is not null then
    if tg_op='DELETE' then v_business_id:=old.business_id; else v_business_id:=new.business_id; end if;
    v_action:=tg_argv[0]; v_limit:=tg_argv[1]::integer; v_seconds:=tg_argv[2]::integer;
    perform private.enforce_rpc_rate(v_action,v_business_id,v_limit,v_seconds);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.throttle_tenant_mutation() from public,anon,authenticated;
create trigger throttle_profile before update on public.business_profiles for each row execute function private.throttle_tenant_mutation('profile','20','60');
create trigger throttle_invitation before insert on public.invitations for each row execute function private.throttle_tenant_mutation('invitation','20','3600');
create trigger throttle_message before insert on public.messages for each row when(new.author='human') execute function private.throttle_tenant_mutation('message','30','60');
create trigger throttle_conversation before update of mode on public.conversations for each row execute function private.throttle_tenant_mutation('conversation','60','60');
create trigger throttle_appointment before insert on public.appointments for each row execute function private.throttle_tenant_mutation('appointment','20','60');
create trigger throttle_notification before insert on public.notifications for each row execute function private.throttle_tenant_mutation('notification','60','60');
create trigger throttle_member_delete before delete on public.memberships for each row execute function private.throttle_tenant_mutation('membership','20','3600');
create trigger throttle_lead before update on public.leads for each row execute function private.throttle_tenant_mutation('lead','60','60');
