-- Intentionally synthetic and inactive. Never seed an auth user, platform admin,
-- consent evidence, enabled entitlement, verified provider, or billing success.
insert into public.businesses(id,name,timezone,state)
values ('10000000-0000-4000-8000-000000000001','Summit Roofing (synthetic fixture)','America/Chicago','account_created')
on conflict(id) do nothing;
insert into public.business_profiles(business_id,name,services,zip_codes,timezone)
values ('10000000-0000-4000-8000-000000000001','Summit Roofing (synthetic fixture)',array['Roof repair','Roof inspection','Storm damage'],array['75201','75204'],'America/Chicago')
on conflict(business_id) do nothing;
insert into public.entitlements(business_id)
values ('10000000-0000-4000-8000-000000000001') on conflict(business_id) do nothing;
insert into public.subscriptions(business_id)
values ('10000000-0000-4000-8000-000000000001') on conflict(business_id) do nothing;
insert into public.contacts(id,business_id,phone,name,zip_code)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','+12025550101','Jessica Example','75201')
on conflict(id) do nothing;
insert into public.leads(id,business_id,contact_id,service,status,summary)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Roof repair','needs_callback','Synthetic enquiry: roof leak near an upstairs window.')
on conflict(id) do nothing;
insert into public.conversations(id,business_id,lead_id,contact_id,mode)
values ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','human')
on conflict(id) do nothing;
insert into public.messages(id,business_id,conversation_id,contact_id,direction,body,author,status)
values ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','inbound','There is a leak near my upstairs window. Could someone call me?','customer','received')
on conflict(id) do nothing;
