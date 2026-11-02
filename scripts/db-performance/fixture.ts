import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { businessId, ownerId } from './queries';

/** Full production migrations with synthetic auth interfaces, never hosted Auth. */
export async function createFixture(scale = 'small') {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;
  `);
  const directory = resolve('supabase/migrations');
  for (const file of (await readdir(directory)).filter((f) => /^000[1-6]_.*\.sql$/.test(f)).sort())
    await db.exec(await readFile(resolve(directory, file), 'utf8'));
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
    ownerId,
    'index-benchmark@example.test',
  ]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$1)', [ownerId]);
  await db.query("insert into public.businesses(id,name) values($1,'Synthetic index tenant')", [
    businessId,
  ]);
  await db.query("insert into public.memberships(business_id,user_id,role) values($1,$2,'owner')", [
    businessId,
    ownerId,
  ]);
  await db.exec(
    `create function pg_temp.bench_business(n integer) returns uuid language sql immutable as $$select case when n=1 then '${businessId}'::uuid else md5('synthetic-business:'||n)::uuid end$$;`,
  );
  await db.exec(
    "insert into public.businesses(id,name) select pg_temp.bench_business(n),'Synthetic tenant '||n from generate_series(2,10) n",
  );
  await db.exec(
    'insert into public.business_profiles(business_id,name) select id,name from public.businesses; insert into public.entitlements(business_id) select id from public.businesses; insert into public.subscriptions(business_id) select id from public.businesses;',
  );
  const contacts = scale === 'large' ? 10000 : 100;
  const messages = scale === 'large' ? 200000 : 1000;
  const notifications = scale === 'large' ? 40000 : 200;
  const usage = scale === 'large' ? 120000 : 500;
  const calls = scale === 'large' ? 100000 : 500;
  const attempts = scale === 'large' ? 40000 : 200;
  const appointments = scale === 'large' ? 10000 : 100;
  await db.exec(`
    insert into public.contacts(id,business_id,phone,name,zip_code)
      select md5('contact:'||g)::uuid,pg_temp.bench_business((g-1)%10+1),'+1202'||lpad(g::text,7,'0'),'Synthetic customer '||g,'75201' from generate_series(1,${contacts}) g;
    insert into public.leads(id,business_id,contact_id,status,summary,created_at,updated_at)
      select md5('lead:'||g)::uuid,pg_temp.bench_business((g-1)%10+1),md5('contact:'||g)::uuid,(array['new','qualified','booked','won','needs_callback','new','new'])[g%7+1],'Synthetic benchmark record',timestamptz '2026-11-01 12:00Z' - (g*71%86400)*interval '1 minute',timestamptz '2026-11-01 12:00Z' - (g*43%86400)*interval '1 minute' from generate_series(1,${contacts}) g;
    insert into public.conversations(id,business_id,lead_id,contact_id,created_at,updated_at)
      select md5('conversation:'||g)::uuid,pg_temp.bench_business((g-1)%10+1),md5('lead:'||g)::uuid,md5('contact:'||g)::uuid,timestamptz '2026-11-01 12:00Z' - (g*71%86400)*interval '1 minute',timestamptz '2026-11-01 12:00Z' - (g*43%86400)*interval '1 minute' from generate_series(1,${contacts}) g;
    insert into public.messages(id,business_id,conversation_id,contact_id,direction,body,status,author,idempotency_key,send_intent_at,created_at)
      select md5('message:'||g)::uuid,pg_temp.bench_business((g-1)%10+1),md5('conversation:'||((g-1)%${contacts}+1))::uuid,md5('contact:'||((g-1)%${contacts}+1))::uuid,case when (g/10)%2=0 then 'inbound' else 'outbound' end,repeat('Synthetic roofing message. ',5),case when (g/10)%2=0 then 'received' else 'delivered' end,case when (g/10)%2=0 then 'customer' else 'ai' end,case when (g/10)%4=1 then 'recovery:'||g else 'bench:'||g end,timestamptz '2026-11-01 12:00Z' - (g*17%86400)*interval '1 minute',timestamptz '2026-11-01 12:00Z' - (g*17%86400)*interval '1 minute' from generate_series(1,${messages}) g;
    insert into public.notifications(business_id,type,message,created_at)
      select pg_temp.bench_business((g-1)%10+1),'callback','Synthetic review notification',timestamptz '2026-11-01 12:00Z' - (g*41%86400)*interval '1 minute' from generate_series(1,${notifications}) g;
    insert into public.usage_events(business_id,kind,idempotency_key,created_at)
      select pg_temp.bench_business((g-1)%10+1),(array['sms','ai','appointment'])[(g/10)%3+1],'benchmark:'||g,timestamptz '2026-11-01 12:00Z' - (g*41%86400)*interval '1 minute' from generate_series(1,${usage}) g;
    insert into public.calls(business_id,call_sid,from_phone,to_phone,recovery_eligible,created_at)
      select pg_temp.bench_business((g-1)%10+1),'CA'||lpad(g::text,32,'0'),'+12025550101','+12025550102',(g/10)%3=0,timestamptz '2026-11-01 12:00Z' - (g*71%86400)*interval '1 minute' from generate_series(1,${calls}) g;
    insert into public.job_attempts(business_id,job_id,status,created_at)
      select pg_temp.bench_business((g-1)%10+1),'synthetic:'||g,'completed',timestamptz '2026-11-01 12:00Z' - (g*41%86400)*interval '1 minute' from generate_series(1,${attempts}) g;
    insert into public.appointments(business_id,lead_id,status,start_at,end_at,idempotency_key,created_at,provider_id,customer_confirmed_at)
      select pg_temp.bench_business((g-1)%10+1),md5('lead:'||((g-1)%${contacts}+1))::uuid,case when (g/10)%5=0 then 'confirmed' else 'requested' end,timestamptz '2026-09-01 12:00Z'+(g/10)*interval '2 hours',timestamptz '2026-09-01 13:00Z'+(g/10)*interval '2 hours','synthetic:'||g,timestamptz '2026-11-01 12:00Z' - (g*41%86400)*interval '1 minute',case when (g/10)%5=0 then 'synthetic-event:'||g else null end,case when (g/10)%5=0 then timestamptz '2026-09-01 12:00Z' else null end from generate_series(1,${appointments}) g;
    analyze;
  `);
  return {
    db,
    counts: {
      businesses: 10,
      contacts,
      leads: contacts,
      conversations: contacts,
      messages,
      notifications,
      usage_events: usage,
      calls,
      job_attempts: attempts,
      appointments,
    },
  };
}

export async function asTenant(db: PGlite) {
  await db.exec('set role authenticated');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [ownerId, JSON.stringify({ sub: ownerId, session_id: ownerId, aal: 'aal1' })],
  );
}
