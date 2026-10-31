-- Worker-only ledgers: no public API access, no secrets in queue payloads.
alter table public.contacts add column sms_eligible boolean not null default false;
-- Only the restricted operator/worker can mark eligibility after country/line-type validation.
create table private.ai_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  message_id uuid not null,
  status text not null check(status in ('submitted','completed','unknown','failed')),
  result jsonb,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique(business_id,message_id),
  foreign key(business_id,message_id) references public.messages(business_id,id)
);
create table private.worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now()
);
alter table private.ai_runs enable row level security;
alter table private.worker_heartbeats enable row level security;
revoke all on private.ai_runs,private.worker_heartbeats from public,anon,authenticated;
grant all on private.ai_runs,private.worker_heartbeats to service_role;

-- Two app bookings cannot reserve overlapping intervals. Google can still change
-- independently; worker also checks provider availability immediately before create.
create function private.protect_appointment_overlap()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('pending','confirmed','unknown') then
    perform pg_advisory_xact_lock(hashtextextended(new.business_id::text,37));
    if exists(select 1 from public.appointments a where a.business_id=new.business_id and a.id<>new.id and a.status in ('pending','confirmed','unknown') and a.start_at<new.end_at+interval '15 minutes' and a.end_at>new.start_at-interval '15 minutes') then
      raise exception 'Appointment overlaps existing reservation' using errcode='23P01';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.protect_appointment_overlap() from public,anon,authenticated;
create trigger appointments_protect_overlap before insert or update of start_at,end_at,status on public.appointments for each row execute function private.protect_appointment_overlap();

create index outbox_worker_claim_idx on public.outbox(available_at,locked_until) where processed_at is null;
create index messages_unknown_idx on public.messages(business_id,created_at) where status='unknown';
