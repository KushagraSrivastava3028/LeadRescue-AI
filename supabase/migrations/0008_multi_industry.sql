-- Existing business profiles retain roofing defaults, services and records.
-- Presets are a read-only catalog; selecting a sector grants no automation approval.
create table public.industry_presets (
  id text primary key,
  services text[] not null,
  intake_questions text[] not null,
  appointment_label text not null
);
alter table public.industry_presets enable row level security;
insert into public.industry_presets values
('roofing',array['Roof repair','Roof inspection','Roof replacement','Storm damage','Gutter repair']::text[],array['Where have you noticed the problem?','When did you first notice it?']::text[],'Roof inspection'),
('plumbing',array['Leak repair','Drain cleaning','Water heater service','Fixture installation']::text[],array['Which fixture or area is affected?','When did the problem start?']::text[],'Plumbing assessment'),
('hvac',array['AC repair','Heating repair','System maintenance','System installation']::text[],array['Is this a heating or cooling issue?','What symptoms have you noticed?']::text[],'HVAC assessment'),
('electrical',array['Electrical repair','Panel assessment','Lighting installation','Outlet installation']::text[],array['Which area or equipment is affected?','When did you first notice the issue?']::text[],'Electrical assessment'),
('landscaping',array['Lawn care','Garden maintenance','Landscape design','Irrigation service']::text[],array['Which outdoor areas need attention?','Are you looking for one-time or recurring service?']::text[],'Site visit'),
('cleaning',array['Home cleaning','Office cleaning','Deep cleaning','Move-out cleaning']::text[],array['How many rooms or areas need cleaning?','Are you looking for one-time or recurring service?']::text[],'Cleaning consultation'),
('pest_control',array['Pest assessment','Rodent control','Insect control','Preventive service']::text[],array['What have you noticed and where?','When did you first notice the activity?']::text[],'Pest assessment'),
('custom',array['Service consultation']::text[],array['Could you describe the work you need?','What is your preferred timeframe?']::text[],'Service appointment');
revoke all on public.industry_presets from public,anon,authenticated;
grant select on public.industry_presets to authenticated,service_role;
create policy industry_presets_read on public.industry_presets for select to authenticated using (true);

alter table public.business_profiles
  add column industry text not null default 'roofing' references public.industry_presets(id),
  add column intake_questions text[] not null default '{}',
  add column appointment_label text not null default 'Roof inspection',
  add constraint profile_intake_questions_check check (
    cardinality(intake_questions)<=3 and array_position(intake_questions,null) is null
  );

alter table public.business_profiles add constraint profile_appointment_label_check check (length(trim(appointment_label)) between 2 and 80);
grant update (industry,intake_questions,appointment_label) on public.business_profiles to authenticated;
alter table public.leads alter column service set default 'Service enquiry';

create function private.validate_industry_profile() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from unnest(new.intake_questions) q where length(trim(q)) not between 3 and 200) then
    raise exception 'Invalid intake questions' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.validate_industry_profile() from public,anon,authenticated;
create trigger validate_industry_profile before insert or update on public.business_profiles for each row execute function private.validate_industry_profile();

-- Calls the existing verified-account/active-session/business-limit gate.
-- Both creation and preset application run in the same transaction.
create function public.create_business_for_industry(p_name text,p_timezone text,p_zip_codes text[],p_industry text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_preset public.industry_presets; v_id uuid;
begin
  select * into v_preset from public.industry_presets where id=p_industry;
  if not found then raise exception 'Unknown industry' using errcode='22023'; end if;
  v_id:=public.create_business(p_name,p_timezone,p_zip_codes);
  update public.business_profiles set industry=v_preset.id,services=v_preset.services,
    intake_questions=v_preset.intake_questions,appointment_label=v_preset.appointment_label
    where business_id=v_id;
  return v_id;
end $$;
revoke all on function public.create_business_for_industry(text,text,text[],text) from public,anon;
grant execute on function public.create_business_for_industry(text,text,text[],text) to authenticated;
