import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseMigration } from '../scripts/migration-runner';

// Real PostgreSQL engine compiled to WASM. auth.* stubs reproduce the claims
// interface only; they do NOT exercise Supabase HTTP, JWT validation or GoTrue.
let db: PGlite;
const ids = {
  businessA: 'a0000000-0000-4000-8000-000000000001',
  businessB: 'b0000000-0000-4000-8000-000000000001',
  ownerA: 'a1000000-0000-4000-8000-000000000001',
  ownerB: 'b1000000-0000-4000-8000-000000000001',
  staff: 'a2000000-0000-4000-8000-000000000001',
  viewer: 'a3000000-0000-4000-8000-000000000001',
  unverified: 'a4000000-0000-4000-8000-000000000001',
  banned: 'a5000000-0000-4000-8000-000000000001',
  contactA: 'a6000000-0000-4000-8000-000000000001',
  contactB: 'b6000000-0000-4000-8000-000000000001',
  leadA: 'a7000000-0000-4000-8000-000000000001',
  leadB: 'b7000000-0000-4000-8000-000000000001',
  conversationA: 'a8000000-0000-4000-8000-000000000001',
  conversationB: 'b8000000-0000-4000-8000-000000000001',
};

async function user(userId: string, aal = 'aal1') {
  await db.exec('set local role authenticated');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [userId, JSON.stringify({ sub: userId, session_id: userId, aal })],
  );
}
async function denied(sql: string, args: unknown[] = []) {
  await db.exec('savepoint denied_action');
  try {
    await db.query(sql, args);
    throw new Error('Expected database access to be denied');
  } catch (error) {
    await db.exec('rollback to savepoint denied_action');
    expect((error as { code?: string }).code).toMatch(
      /^(42501|23514|23503|22023|55P03|23505|23P01|PT429)$/,
    );
  }
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
    create table auth.sessions (id uuid primary key,user_id uuid not null references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;
  `);
  const path = resolve('supabase/migrations');
  for (const file of (await readdir(path)).filter((x) => x.endsWith('.sql')).sort()) {
    for (const statement of parseMigration(await readFile(resolve(path, file), 'utf8')).statements)
      await db.exec(statement);
  }
  const people = [
    [ids.ownerA, 'owner-a@example.test'],
    [ids.ownerB, 'owner-b@example.test'],
    [ids.staff, 'staff@example.test'],
    [ids.viewer, 'viewer@example.test'],
    [ids.unverified, 'unverified@example.test'],
    [ids.banned, 'banned@example.test'],
  ];
  for (const [id, email] of people)
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at,banned_until) values($1,$2,$3,$4)',
      [
        id,
        email,
        id === ids.unverified ? null : new Date(),
        id === ids.banned ? new Date(Date.now() + 86400000) : null,
      ],
    );
  for (const [id] of people)
    await db.query('insert into auth.sessions(id,user_id) values($1,$1)', [id]);
  for (const [businessId, ownerId, name] of [
    [ids.businessA, ids.ownerA, 'Tenant A'],
    [ids.businessB, ids.ownerB, 'Tenant B'],
  ]) {
    await db.query('insert into public.businesses(id,name) values($1,$2)', [businessId, name]);
    await db.query(
      "insert into public.memberships(business_id,user_id,role) values($1,$2,'owner')",
      [businessId, ownerId],
    );
    await db.query('insert into public.business_profiles(business_id,name) values($1,$2)', [
      businessId,
      name,
    ]);
    await db.query('insert into public.entitlements(business_id) values($1)', [businessId]);
  }
  for (const [person, role] of [
    [ids.staff, 'staff'],
    [ids.viewer, 'viewer'],
    [ids.unverified, 'viewer'],
    [ids.banned, 'viewer'],
  ])
    await db.query('insert into public.memberships(business_id,user_id,role) values($1,$2,$3)', [
      ids.businessA,
      person,
      role,
    ]);
  for (const [business, contact, lead, conversation, phone] of [
    [ids.businessA, ids.contactA, ids.leadA, ids.conversationA, '+12025550101'],
    [ids.businessB, ids.contactB, ids.leadB, ids.conversationB, '+12025550102'],
  ]) {
    await db.query(
      "insert into public.contacts(id,business_id,phone,name) values($1,$2,$3,'Synthetic customer')",
      [contact, business, phone],
    );
    await db.query('insert into public.leads(id,business_id,contact_id) values($1,$2,$3)', [
      lead,
      business,
      contact,
    ]);
    await db.query(
      'insert into public.conversations(id,business_id,lead_id,contact_id) values($1,$2,$3,$4)',
      [conversation, business, lead, contact],
    );
  }
}, 60000);
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db?.close();
});

describe('database tenant isolation and authorization', () => {
  it('applies every migration and enables RLS on all public application tables', async () => {
    const result = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='public' and not rowsecurity",
    );
    expect(result.rows).toEqual([]);
  });
  it('owner, staff, viewer can read their tenant and cannot read another tenant', async () => {
    for (const person of [ids.ownerA, ids.staff, ids.viewer]) {
      await user(person);
      const result = await db.query<{ business_id: string }>(
        'select business_id from public.leads',
      );
      expect(result.rows).toEqual([{ business_id: ids.businessA }]);
      expect(
        (await db.query('select * from public.conversations where id=$1', [ids.conversationB]))
          .rows,
      ).toEqual([]);
    }
  });
  it('anonymous users cannot read tenant tables or invoke bootstrap', async () => {
    await db.exec('set local role anon');
    await denied('select * from public.leads');
    await denied("select public.create_business('Forged business')");
  });
  it('rejects a revoked provider session even when the old user claims remain', async () => {
    await db.query('delete from auth.sessions where user_id=$1', [ids.ownerA]);
    await user(ids.ownerA, 'aal2');
    expect(
      (await db.query<{ allowed: boolean }>('select public.check_active_session() as allowed'))
        .rows[0].allowed,
    ).toBe(false);
    expect((await db.query('select * from public.leads')).rows).toEqual([]);
    await denied("select public.create_business('Revoked account')");
    await denied("select public.take_over_conversation($1,$2,'human')", [
      ids.businessA,
      ids.conversationA,
    ]);
  });
  it('unverified and banned accounts have no membership-derived access', async () => {
    for (const person of [ids.unverified, ids.banned]) {
      await user(person);
      expect((await db.query('select * from public.leads')).rows).toEqual([]);
      await denied("select public.take_over_conversation($1,$2,'human')", [
        ids.businessA,
        ids.conversationA,
      ]);
    }
  });
  it('revokes tenant reads immediately after membership or business suspension', async () => {
    await db.query(
      'update public.memberships set suspended_at=now() where business_id=$1 and user_id=$2',
      [ids.businessA, ids.staff],
    );
    await user(ids.staff);
    expect((await db.query('select * from public.leads')).rows).toEqual([]);
    await db.exec('reset role');
    await db.query('update public.businesses set suspended_at=now() where id=$1', [ids.businessA]);
    await user(ids.ownerA);
    expect((await db.query('select * from public.leads')).rows).toEqual([]);
  });
  it('owner can update allowlisted profile columns and staff/viewer cannot', async () => {
    await user(ids.ownerA);
    expect(
      (
        await db.query(
          "update public.business_profiles set name='Updated name' where business_id=$1 returning name",
          [ids.businessA],
        )
      ).rows,
    ).toEqual([{ name: 'Updated name' }]);
    for (const person of [ids.staff, ids.viewer]) {
      await user(person);
      expect(
        (
          await db.query(
            "update public.business_profiles set name='Unauthorized' where business_id=$1 returning name",
            [ids.businessA],
          )
        ).rows,
      ).toEqual([]);
    }
  });
  it('rejects cross-tenant profile updates and nested conversation identifiers', async () => {
    await user(ids.ownerA);
    expect(
      (
        await db.query(
          "update public.business_profiles set name='Cross tenant' where business_id=$1 returning name",
          [ids.businessB],
        )
      ).rows,
    ).toEqual([]);
    await denied("select public.take_over_conversation($1,$2,'human')", [
      ids.businessA,
      ids.conversationB,
    ]);
    await denied("select public.take_over_conversation($1,$2,'human')", [
      ids.businessB,
      ids.conversationB,
    ]);
  });
  it('prevents mass assignment of business IDs, roles, entitlements, and verification', async () => {
    await user(ids.ownerA);
    await denied('update public.business_profiles set business_id=$1 where business_id=$2', [
      ids.businessB,
      ids.businessA,
    ]);
    await denied("update public.memberships set role='owner' where user_id=$1", [ids.viewer]);
    await denied('update public.entitlements set automation_enabled=true where business_id=$1', [
      ids.businessA,
    ]);
    await denied('update public.businesses set verified_at=now() where id=$1', [ids.businessA]);
  });
  it('does not expose encrypted provider tokens, events, outbox, consent evidence, or trial identities', async () => {
    await user(ids.ownerA);
    for (const table of [
      'provider_accounts',
      'calendar_connections',
      'webhook_events',
      'outbox',
      'consents',
      'suppressions',
      'invitations',
      'trial_registry',
    ])
      await denied(`select * from public.${table}`);
    await denied('select * from private.platform_admins');
  });
  it('viewer cannot take over, enqueue messages, or change lead outcomes', async () => {
    await user(ids.viewer);
    await denied("select public.take_over_conversation($1,$2,'human')", [
      ids.businessA,
      ids.conversationA,
    ]);
    await denied("select public.enqueue_manual_message($1,$2,'Hello')", [
      ids.businessA,
      ids.conversationA,
    ]);
    await denied("select public.update_lead($1,$2,'won')", [ids.businessA, ids.leadA]);
  });
  it('requires takeover before an outbound intent and writes intent+outbox together', async () => {
    await user(ids.staff);
    await denied("select public.enqueue_manual_message($1,$2,'Hello')", [
      ids.businessA,
      ids.conversationA,
    ]);
    await db.query("select public.take_over_conversation($1,$2,'human')", [
      ids.businessA,
      ids.conversationA,
    ]);
    const message = await db.query<{ id: string }>(
      "select public.enqueue_manual_message($1,$2,'We will call you shortly.') as id",
      [ids.businessA, ids.conversationA],
    );
    await db.exec('reset role');
    const outbox = await db.query<{ topic: string; payload: { messageId: string } }>(
      'select topic,payload from public.outbox where business_id=$1',
      [ids.businessA],
    );
    expect(outbox.rows).toEqual([
      {
        topic: 'sms.send',
        payload: { messageId: message.rows[0].id, conversationId: ids.conversationA, manual: true },
      },
    ]);
  });
  it('records owner-confirmed won jobs without inventing revenue', async () => {
    await user(ids.staff);
    await denied("select public.update_lead($1,$2,'won')", [ids.businessA, ids.leadA]);
    await user(ids.ownerA);
    await db.query("select public.update_lead($1,$2,'won')", [ids.businessA, ids.leadA]);
    const result = await db.query<{ status: string; won_confirmed_by: string }>(
      'select status,won_confirmed_by from public.leads where id=$1',
      [ids.leadA],
    );
    expect(result.rows[0]).toEqual({ status: 'won', won_confirmed_by: ids.ownerA });
    await denied("select public.update_lead($1,$2,'booked')", [ids.businessA, ids.leadA]);
  });
  it('rejects invalid service ZIP codes and timezone at the database boundary', async () => {
    await user(ids.ownerA);
    await denied(
      "update public.business_profiles set zip_codes=array['75201','invalid'] where business_id=$1",
      [ids.businessA],
    );
    await denied(
      "update public.business_profiles set timezone='Not/A_Timezone' where business_id=$1",
      [ids.businessA],
    );
  });
  it('preserves the last active owner even through privileged writes', async () => {
    await denied("delete from public.memberships where business_id=$1 and role='owner'", [
      ids.businessA,
    ]);
    await denied(
      "update public.memberships set role='staff' where business_id=$1 and role='owner'",
      [ids.businessA],
    );
  });
  it('blocks cross-tenant foreign keys even for privileged worker inserts', async () => {
    await denied('insert into public.leads(business_id,contact_id) values($1,$2)', [
      ids.businessA,
      ids.contactB,
    ]);
    await denied(
      "insert into public.messages(business_id,conversation_id,contact_id,direction,body) values($1,$2,$3,'outbound','wrong tenant')",
      [ids.businessA, ids.conversationB, ids.contactA],
    );
  });
  it('binds invitation consumption to the intended verified email and makes it single use', async () => {
    const token = 'synthetic-invitation-token-01234567890123456789';
    await user(ids.ownerA);
    await db.query('select public.create_invitation($1,$2,$3,$4)', [
      ids.businessA,
      'owner-b@example.test',
      'staff',
      createHash('sha256').update(token).digest('hex'),
    ]);
    await user(ids.staff);
    await denied('select public.accept_invitation($1)', [token]);
    await user(ids.ownerB);
    expect(
      (await db.query<{ id: string }>('select public.accept_invitation($1) as id', [token])).rows[0]
        .id,
    ).toBe(ids.businessA);
    await denied('select public.accept_invitation($1)', [token]);
  });
  it('does not allow invitation role elevation to owner', async () => {
    await user(ids.ownerA);
    await denied('select public.create_invitation($1,$2,$3,$4)', [
      ids.businessA,
      'new@example.test',
      'owner',
      'a'.repeat(64),
    ]);
  });
  it('throttles valid direct database mutation calls even if the HTTP gateway is bypassed', async () => {
    await user(ids.ownerA);
    for (let n = 0; n < 20; n++)
      await db.query('select public.create_invitation($1,$2,$3,$4)', [
        ids.businessA,
        `invite-${n}@example.test`,
        'viewer',
        createHash('sha256').update(`synthetic-invite-${n}`).digest('hex'),
      ]);
    await denied('select public.create_invitation($1,$2,$3,$4)', [
      ids.businessA,
      'over-limit@example.test',
      'viewer',
      'c'.repeat(64),
    ]);
    // A different user/tenant has an independent bucket.
    await user(ids.ownerB);
    await db.query('select public.create_invitation($1,$2,$3,$4)', [
      ids.businessB,
      'independent@example.test',
      'viewer',
      'd'.repeat(64),
    ]);
  });
  it('requires provider-verified phone, messaging registration and live test before trial activation', async () => {
    await user(ids.ownerA);
    await denied('select public.activate_trial($1)', [ids.businessA]);
    await denied('select public.activate_trial($1,$2)', [ids.businessA, 'a'.repeat(64)]);
  });
  it('creates business ownership atomically only for verified accounts', async () => {
    await user(ids.unverified);
    await denied(
      "select public.create_business('Synthetic business','America/Chicago',array['75201'])",
    );
    await user(ids.ownerA);
    const result = await db.query<{ id: string }>(
      "select public.create_business('Synthetic business','America/Chicago',array['75201']) as id",
    );
    const businessId = result.rows[0].id;
    expect(
      (
        await db.query<{ role: string }>(
          'select role from public.memberships where business_id=$1',
          [businessId],
        )
      ).rows,
    ).toEqual([{ role: 'owner' }]);
    expect(
      (
        await db.query<{ automation_enabled: boolean }>(
          'select automation_enabled from public.entitlements where business_id=$1',
          [businessId],
        )
      ).rows,
    ).toEqual([{ automation_enabled: false }]);
  });
  it('does not promote tenant owners to platform admins and rejects aal1 admins', async () => {
    await user(ids.ownerA, 'aal2');
    expect(
      (await db.query<{ allowed: boolean }>('select public.check_platform_admin() as allowed'))
        .rows[0].allowed,
    ).toBe(false);
    await db.exec('reset role');
    await db.query("insert into private.platform_admins(user_id,role) values($1,'operator')", [
      ids.ownerA,
    ]);
    await user(ids.ownerA, 'aal1');
    expect(
      (await db.query<{ allowed: boolean }>('select public.check_platform_admin() as allowed'))
        .rows[0].allowed,
    ).toBe(false);
    await denied('select public.admin_pause_automation($1,$2)', [
      ids.businessA,
      'Synthetic security test',
    ]);
    await user(ids.ownerA, 'aal2');
    expect(
      (await db.query<{ allowed: boolean }>('select public.check_platform_admin() as allowed'))
        .rows[0].allowed,
    ).toBe(true);
  });
});

describe('database durable events, budgets and spending controls', () => {
  it('deduplicates webhook events without losing the transactional outbox record', async () => {
    await db.exec('set local role service_role');
    const args = [
      ids.businessA,
      'twilio',
      'call-event-1',
      JSON.stringify({ status: 'no-answer' }),
      'twilio.call_status',
    ];
    const first = await db.query<{ id: string | null }>(
      'select public.persist_webhook($1,$2,$3,$4::jsonb,$5) as id',
      args,
    );
    const duplicate = await db.query<{ id: string | null }>(
      'select public.persist_webhook($1,$2,$3,$4::jsonb,$5) as id',
      args,
    );
    expect(first.rows[0].id).toBeTruthy();
    expect(duplicate.rows[0].id).toBeNull();
    expect(
      (await db.query('select * from public.outbox where business_id=$1', [ids.businessA])).rows,
    ).toHaveLength(1);
  });
  it('rejects authenticated callers of service-only webhook, rate, usage and activation routines', async () => {
    await user(ids.ownerA);
    await denied("select public.persist_webhook($1,'twilio','fake','{}','twilio.sms')", [
      ids.businessA,
    ]);
    await denied("select public.reserve_usage($1,'sms','forged')", [ids.businessA]);
    await denied("select public.consume_rate_limit('forged',1,60)");
  });
  it('enforces an atomic hard usage cap and deduplicates reservations', async () => {
    await db.query("update public.businesses set state='trial_active' where id=$1", [
      ids.businessA,
    ]);
    await db.query(
      "update public.entitlements set automation_enabled=true,valid_until=now()+interval '1 day',sms_limit=1 where business_id=$1",
      [ids.businessA],
    );
    await db.exec('set local role service_role');
    const first = await db.query<{ id: string }>(
      "select public.reserve_usage($1,'sms','request-1') as id",
      [ids.businessA],
    );
    const duplicate = await db.query<{ id: string }>(
      "select public.reserve_usage($1,'sms','request-1') as id",
      [ids.businessA],
    );
    expect(first.rows).toEqual(duplicate.rows);
    await denied("select public.reserve_usage($1,'sms','request-2')", [ids.businessA]);
    expect(
      (
        await db.query<{ sms_used: number }>(
          'select sms_used from public.entitlements where business_id=$1',
          [ids.businessA],
        )
      ).rows[0].sms_used,
    ).toBe(1);
  });
  it('blocks reservations after trial expiry and cancellation', async () => {
    await db.query(
      "update public.entitlements set automation_enabled=true,valid_until=now()-interval '1 second' where business_id=$1",
      [ids.businessA],
    );
    await denied("select public.reserve_usage($1,'sms','expired')", [ids.businessA]);
    await db.query(
      "update public.entitlements set valid_until=now()+interval '1 day' where business_id=$1",
      [ids.businessA],
    );
    await db.query("update public.businesses set state='canceled' where id=$1", [ids.businessA]);
    await denied("select public.reserve_usage($1,'sms','canceled')", [ids.businessA]);
  });
  it('preserves operator and billing-review holds even if provider entitlements otherwise appear active', async () => {
    await db.query(
      "update public.businesses set state='paid_active',automation_hold_at=now() where id=$1",
      [ids.businessA],
    );
    await db.query(
      "update public.entitlements set automation_enabled=true,valid_until=now()+interval '1 day' where business_id=$1",
      [ids.businessA],
    );
    await denied("select public.reserve_usage($1,'sms','operator-hold')", [ids.businessA]);
    await db.query('update public.businesses set automation_hold_at=null where id=$1', [
      ids.businessA,
    ]);
    await db.query(
      'insert into public.subscriptions(business_id,review_required_at) values($1,now())',
      [ids.businessA],
    );
    await denied("select public.reserve_usage($1,'sms','billing-review')", [ids.businessA]);
    await user(ids.ownerA);
    await denied('update public.businesses set automation_hold_at=null where id=$1', [
      ids.businessA,
    ]);
    await denied('update public.subscriptions set review_required_at=null where business_id=$1', [
      ids.businessA,
    ]);
  });
  it('uses shared database rate buckets and returns retry information', async () => {
    await db.exec('set local role service_role');
    const one = await db.query<{
      value: { allowed: boolean; remaining: number; retry_after: number };
    }>("select public.consume_rate_limit('test-auth-bucket',1,60) as value");
    const two = await db.query<{
      value: { allowed: boolean; remaining: number; retry_after: number };
    }>("select public.consume_rate_limit('test-auth-bucket',1,60) as value");
    expect(one.rows[0].value.allowed).toBe(true);
    expect(two.rows[0].value.allowed).toBe(false);
    expect(two.rows[0].value.remaining).toBe(0);
    expect(two.rows[0].value.retry_after).toBeGreaterThan(0);
  });
  it('prevents routing loops and unverified enabled destinations at the database layer', async () => {
    const provider = await db.query<{ id: string }>(
      "insert into public.provider_accounts(business_id,provider,account_sid) values($1,'twilio','AC-synthetic') returning id",
      [ids.businessA],
    );
    await denied(
      "insert into public.phone_numbers(business_id,provider_account_id,phone,provider_id,forward_to,routing_enabled,destination_verified_at) values($1,$2,'+12025550101','PN-synthetic','+12025550101',true,now())",
      [ids.businessA, provider.rows[0].id],
    );
    await denied(
      "insert into public.phone_numbers(business_id,provider_account_id,phone,provider_id,forward_to,routing_enabled) values($1,$2,'+12025550101','PN-synthetic','+12025550102',true)",
      [ids.businessA, provider.rows[0].id],
    );
  });
  it('starts a single 14-day trial only after all verified server prerequisites', async () => {
    for (const [business, account, phone, providerId] of [
      [ids.businessA, 'AC-test-a', '+12025550103', 'PN-test-a'],
      [ids.businessB, 'AC-test-b', '+12025550104', 'PN-test-b'],
    ]) {
      const provider = await db.query<{ id: string }>(
        "insert into public.provider_accounts(business_id,provider,account_sid) values($1,'twilio',$2) returning id",
        [business, account],
      );
      await db.query(
        "insert into public.phone_numbers(business_id,provider_account_id,phone,provider_id,forward_to,routing_enabled,destination_verified_at,registration_status) values($1,$2,$3,$4,'+12025550109',true,now(),'approved')",
        [business, provider.rows[0].id, phone, providerId],
      );
      await db.query(
        'update public.businesses set verified_at=now(),live_test_passed_at=now() where id=$1',
        [business],
      );
    }
    await user(ids.ownerA);
    await db.query('select public.activate_trial($1)', [ids.businessA]);
    const trial = await db.query<{ state: string; days: number }>(
      'select state,extract(epoch from trial_ends_at-trial_started_at)/86400 as days from public.businesses where id=$1',
      [ids.businessA],
    );
    expect(trial.rows[0].state).toBe('trial_active');
    expect(Number(trial.rows[0].days)).toBe(14);
    await denied('select public.activate_trial($1)', [ids.businessA]);
    await user(ids.ownerB);
    await denied('select public.activate_trial($1)', [ids.businessB]);
  });
  it('refuses to label a booking confirmed before customer confirmation and provider creation', async () => {
    await denied(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key) values($1,$2,'2026-11-02T16:00:00Z','2026-11-02T17:00:00Z','confirmed','unverified-booking')",
      [ids.businessA, ids.leadA],
    );
  });
  it('protects appointment overlap and the 15-minute buffer within a tenant', async () => {
    await db.query(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T16:00:00Z','2026-11-02T17:00:00Z','pending','first-booking',now())",
      [ids.businessA, ids.leadA],
    );
    await denied(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T17:10:00Z','2026-11-02T18:10:00Z','pending','overlapping-booking',now())",
      [ids.businessA, ids.leadA],
    );
    // The same interval in another tenant is independent.
    await db.query(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T16:00:00Z','2026-11-02T17:00:00Z','pending','other-tenant-booking',now())",
      [ids.businessB, ids.leadB],
    );
    await db.query(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T17:15:00Z','2026-11-02T18:15:00Z','pending','buffer-safe-booking',now())",
      [ids.businessA, ids.leadA],
    );
  });
  it('keeps unknown provider booking outcomes reserved until reconciliation', async () => {
    await db.query(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T16:00:00Z','2026-11-02T17:00:00Z','unknown','unknown-booking',now())",
      [ids.businessA, ids.leadA],
    );
    await denied(
      "insert into public.appointments(business_id,lead_id,start_at,end_at,status,idempotency_key,customer_confirmed_at) values($1,$2,'2026-11-02T16:30:00Z','2026-11-02T17:30:00Z','pending','possibly-double-booked',now())",
      [ids.businessA, ids.leadA],
    );
  });
});

describe('provider purchase intents and customer-confirmed inspection requests', () => {
  function futureSlot() {
    const day = new Date(Date.now() + 3 * 86400000);
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    return `${day.toISOString().slice(0, 10)}T16:00:00Z`;
  }
  async function provider(business = ids.businessA) {
    return (
      await db.query<{ id: string }>(
        "insert into public.provider_accounts(business_id,provider,account_sid) values($1,'twilio',$2) returning id",
        [business, `AC-${business}`],
      )
    ).rows[0].id;
  }
  it('keeps number purchase functions and operation ledger inaccessible to browser roles', async () => {
    await user(ids.ownerA);
    await denied('select public.begin_phone_provisioning($1)', [ids.businessA]);
    await denied('select * from private.phone_provisioning_operations');
  });
  it('blocks repeated provisioning attempts, including unknown outcomes, until explicit reconciliation', async () => {
    const accountId = await provider();
    await db.exec('set local role service_role');
    const op = (
      await db.query<{ id: string }>('select public.begin_phone_provisioning($1) as id', [
        ids.businessA,
      ])
    ).rows[0].id;
    await denied('select public.begin_phone_provisioning($1)', [ids.businessA]);
    await db.query('select public.mark_phone_provisioning_unknown($1,$2)', [op, ids.businessA]);
    await denied('select public.begin_phone_provisioning($1)', [ids.businessA]);
    await db.query('select public.finish_phone_provisioning($1,$2,$3,$4,$5)', [
      op,
      ids.businessA,
      accountId,
      `PN${'a'.repeat(32)}`,
      '+12025550101',
    ]);
    // Idempotent finalization with the exact proven provider number is harmless.
    await db.query('select public.finish_phone_provisioning($1,$2,$3,$4,$5)', [
      op,
      ids.businessA,
      accountId,
      `PN${'a'.repeat(32)}`,
      '+12025550101',
    ]);
    const phone = (
      await db.query<{
        routing_enabled: boolean;
        registration_status: string;
        destination_verified_at: null;
      }>(
        'select routing_enabled,registration_status,destination_verified_at from public.phone_numbers where business_id=$1',
        [ids.businessA],
      )
    ).rows[0];
    expect(phone).toEqual({
      routing_enabled: false,
      registration_status: 'pending',
      destination_verified_at: null,
    });
    await denied('select public.begin_phone_provisioning($1)', [ids.businessA]);
  });
  it('binds provisioning finalization to both operation and trusted provider tenant', async () => {
    await provider();
    const accountB = await provider(ids.businessB);
    const op = (
      await db.query<{ id: string }>('select public.begin_phone_provisioning($1) as id', [
        ids.businessA,
      ])
    ).rows[0].id;
    await denied('select public.finish_phone_provisioning($1,$2,$3,$4,$5)', [
      op,
      ids.businessB,
      accountB,
      `PN${'b'.repeat(32)}`,
      '+12025550102',
    ]);
    await denied('select public.finish_phone_provisioning($1,$2,$3,$4,$5)', [
      op,
      ids.businessA,
      accountB,
      `PN${'b'.repeat(32)}`,
      '+12025550102',
    ]);
  });
  it('allows staff to request an inspection while viewers and cross-tenant nested IDs are denied', async () => {
    await user(ids.viewer);
    await denied('select public.request_appointment($1,$2,$3,$4)', [
      ids.businessA,
      ids.leadA,
      futureSlot(),
      'Customer asked for an inspection.',
    ]);
    await user(ids.staff);
    await denied('select public.request_appointment($1,$2,$3,$4)', [
      ids.businessA,
      ids.leadB,
      futureSlot(),
      'Wrong tenant.',
    ]);
    const result = await db.query<{ id: string }>(
      'select public.request_appointment($1,$2,$3,$4) as id',
      [ids.businessA, ids.leadA, futureSlot(), 'Customer asked for an inspection.'],
    );
    expect(
      (
        await db.query<{ status: string; customer_confirmed_at: null }>(
          'select status,customer_confirmed_at from public.appointments where id=$1',
          [result.rows[0].id],
        )
      ).rows[0],
    ).toEqual({ status: 'requested', customer_confirmed_at: null });
    await denied('select public.confirm_appointment($1,$2,$3)', [
      ids.businessA,
      result.rows[0].id,
      'a'.repeat(64),
    ]);
  });
  it('rejects inspection slots outside service hours and bounded future horizon', async () => {
    await user(ids.ownerA);
    await denied('select public.request_appointment($1,$2,$3,$4)', [
      ids.businessA,
      ids.leadA,
      futureSlot().replace('T16:00:00Z', 'T03:00:00Z'),
      'Outside hours.',
    ]);
    await denied('select public.request_appointment($1,$2,$3,$4)', [
      ids.businessA,
      ids.leadA,
      new Date(Date.now() + 100 * 86400000).toISOString(),
      'Too far ahead.',
    ]);
  });
  it('honors explicitly disabled service days even when their hours remain configured', async () => {
    await db.query(
      'update public.business_profiles set opening_hours=$2::jsonb where business_id=$1',
      [
        ids.businessA,
        JSON.stringify(
          Object.fromEntries(
            ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
              day,
              { open: '08:00', close: '17:00', enabled: false },
            ]),
          ),
        ),
      ],
    );
    await user(ids.ownerA);
    await denied('select public.request_appointment($1,$2,$3,$4)', [
      ids.businessA,
      ids.leadA,
      futureSlot(),
      'Day is disabled.',
    ]);
  });
  it('records confirmation without a calendar as a callback request without claiming booked', async () => {
    await user(ids.ownerA);
    const appointment = (
      await db.query<{ id: string }>('select public.request_appointment($1,$2,$3,$4) as id', [
        ids.businessA,
        ids.leadA,
        futureSlot(),
        'Inspection request.',
      ])
    ).rows[0].id;
    await db.exec('set local role service_role');
    const status = (
      await db.query<{ status: string }>('select public.confirm_appointment($1,$2,$3) as status', [
        ids.businessA,
        appointment,
        'a'.repeat(64),
      ])
    ).rows[0].status;
    expect(status).toBe('requested');
    await db.query('select public.confirm_appointment($1,$2,$3)', [
      ids.businessA,
      appointment,
      'a'.repeat(64),
    ]);
    expect(
      (
        await db.query(
          "select * from public.outbox where business_id=$1 and topic='calendar.book'",
          [ids.businessA],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from public.notifications where business_id=$1 and type='booking_callback'",
          [ids.businessA],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('binds calendar connection and enqueues a single pending booking after explicit customer confirmation', async () => {
    const connection = (
      await db.query<{ id: string }>(
        "insert into public.calendar_connections(business_id,calendar_id,refresh_token_ciphertext,key_version,scopes) values($1,'primary','synthetic-not-a-token','v1',array['synthetic']) returning id",
        [ids.businessA],
      )
    ).rows[0].id;
    await user(ids.ownerA);
    const appointment = (
      await db.query<{ id: string }>('select public.request_appointment($1,$2,$3,$4) as id', [
        ids.businessA,
        ids.leadA,
        futureSlot(),
        'Inspection request.',
      ])
    ).rows[0].id;
    await db.exec('set local role service_role');
    await denied('select public.confirm_appointment($1,$2,$3)', [
      ids.businessB,
      appointment,
      'a'.repeat(64),
    ]);
    await denied('select public.confirm_appointment($1,$2,$3)', [ids.businessA, appointment, null]);
    expect(
      (
        await db.query<{ status: string }>(
          'select public.confirm_appointment($1,$2,$3) as status',
          [ids.businessA, appointment, 'a'.repeat(64)],
        )
      ).rows[0].status,
    ).toBe('pending');
    await db.query('select public.confirm_appointment($1,$2,$3)', [
      ids.businessA,
      appointment,
      'a'.repeat(64),
    ]);
    const row = (
      await db.query<{ status: string; calendar_connection_id: string }>(
        'select status,calendar_connection_id from public.appointments where business_id=$1 and id=$2',
        [ids.businessA, appointment],
      )
    ).rows[0];
    expect(row).toEqual({ status: 'pending', calendar_connection_id: connection });
    expect(
      (
        await db.query(
          "select * from public.outbox where business_id=$1 and topic='calendar.book'",
          [ids.businessA],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
