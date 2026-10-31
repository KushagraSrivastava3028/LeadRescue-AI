import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const fake = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
  qualify: vi.fn(),
  subscriptions: vi.fn(),
  prices: vi.fn(),
  book: vi.fn(),
}));
vi.mock('../src/lib/server/providers/database', () => ({
  query: fake.query,
  transaction: fake.transaction,
}));
vi.mock('../src/lib/server/providers/telephony', () => ({ sendSms: fake.send }));
vi.mock('../src/lib/server/providers/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/server/providers/ai')>();
  return { ...original, qualifyConversation: fake.qualify };
});
vi.mock('../src/lib/server/providers/billing', () => ({
  stripeClient: () => ({
    subscriptions: { list: fake.subscriptions },
    prices: { retrieve: fake.prices },
  }),
}));
vi.mock('../src/lib/server/providers/calendar', () => ({ createCalendarBooking: fake.book }));
import { dispatchMessage } from '../src/worker/dispatch';
import { qualifyMessage } from '../src/worker/qualify';
import { processTwilioEvent } from '../src/worker/events';
import { reconcileBilling } from '../src/worker/billing';
import { bookAppointment } from '../src/worker/calendar';

let db: PGlite;
const business = 'a0000000-0000-4000-8000-000000000001',
  contact = 'a6000000-0000-4000-8000-000000000001',
  lead = 'a7000000-0000-4000-8000-000000000001',
  conversation = 'a8000000-0000-4000-8000-000000000001',
  phoneId = 'a9000000-0000-4000-8000-000000000001',
  accountId = 'aa000000-0000-4000-8000-000000000001';
function fixturePrice() {
  return {
    id: 'price_fixture',
    active: true,
    currency: 'usd',
    type: 'recurring',
    billing_scheme: 'per_unit',
    unit_amount: 29900,
    custom_unit_amount: null,
    transform_quantity: null,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  };
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;",
  );
  await db.exec(
    'create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));',
  );
  for (const name of (await readdir(resolve('supabase/migrations')))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  fake.query.mockImplementation(
    async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows,
  );
  fake.transaction.mockImplementation(
    async (
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
    ) =>
      db.transaction(async (tx) =>
        fn({ query: async (sql, values = []) => tx.query(sql, values) }),
      ),
  );
}, 30000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});

beforeEach(async () => {
  fake.send.mockReset().mockResolvedValue({ sid: `SM${'2'.repeat(32)}`, status: 'queued' });
  fake.qualify.mockReset();
  fake.book.mockReset().mockResolvedValue({ providerId: 'calendarfixture' });
  vi.stubEnv('TWILIO_ENABLED', 'true');
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'0'.repeat(32)}`);
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'synthetic-test-token');
  vi.stubEnv('TWILIO_WEBHOOK_ORIGIN', 'https://app.example.test');
  vi.stubEnv('PLATFORM_DAILY_SMS_SEGMENT_LIMIT', '1000');
  vi.stubEnv('AI_ENABLED', 'true');
  vi.stubEnv('AI_MAX_CALL_COST_MINOR', '1');
  vi.stubEnv('PLATFORM_DAILY_AI_COST_LIMIT_MINOR', '1000');
  await db.exec('truncate public.businesses cascade');
  const hour = new Date().getUTCHours();
  await db.query(
    "insert into public.businesses(id,name,state,verified_at,live_test_passed_at,trial_started_at,trial_ends_at) values($1,'Synthetic Roofing','trial_active',now(),now(),now(),now()+interval '14 days')",
    [business],
  );
  await db.query(
    "insert into public.business_profiles(business_id,name,services,zip_codes,timezone,quiet_start,quiet_end) values($1,'Synthetic Roofing',array['Roof repair'],array['75201'],'Etc/UTC',$2,$3)",
    [business, (hour + 1) % 24, (hour + 2) % 24],
  );
  await db.query(
    "insert into public.provider_accounts(id,business_id,provider,account_sid) values($1,$2,'twilio',$3)",
    [accountId, business, `AC${'0'.repeat(32)}`],
  );
  await db.query(
    "insert into public.phone_numbers(id,business_id,provider_account_id,phone,provider_id,registration_status) values($1,$2,$3,'+12145550187','PNfixture','approved')",
    [phoneId, business, accountId],
  );
  await db.query(
    "insert into public.entitlements(business_id,automation_enabled,valid_until,sms_limit,ai_limit) values($1,true,now()+interval '14 days',100,100)",
    [business],
  );
  await db.query('insert into public.subscriptions(business_id) values($1)', [business]);
  await db.query(
    "insert into public.contacts(id,business_id,phone,sms_eligible) values($1,$2,'+12145550188',true)",
    [contact, business],
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
  await db.query(
    "insert into public.consents(business_id,contact_id,sender_phone,scope,source,policy_version,evidence_reference,granted_at) values($1,$2,'+12145550187','service_recovery','operator_verified','synthetic-v1','synthetic-evidence',now())",
    [business, contact],
  );
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_synthetic_fixture');
  vi.stubEnv('STRIPE_PRICE_ID', 'price_fixture');
  vi.stubEnv('PLAN_MONTHLY_PRICE_MINOR', '29900');
  vi.stubEnv('PLAN_PAID_SMS_LIMIT', '500');
  vi.stubEnv('PLAN_PAID_AI_LIMIT', '500');
  fake.prices.mockReset().mockResolvedValue(fixturePrice());
  fake.subscriptions.mockReset().mockResolvedValue({
    data: [
      {
        id: 'sub_fixture',
        created: 1,
        status: 'active',
        cancel_at_period_end: false,
        latest_invoice: { status: 'paid', amount_paid: 29900, currency: 'usd' },
        items: {
          data: [
            {
              quantity: 1,
              price: fixturePrice(),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
              current_period_start: Math.floor(Date.now() / 1000),
            },
          ],
        },
      },
    ],
  });
});

async function message(direction = 'outbound') {
  const id = randomUUID();
  await db.query(
    "insert into public.messages(id,business_id,conversation_id,contact_id,direction,body,author,idempotency_key) values($1,$2,$3,$4,$5,'Roof help',$6,$7)",
    [
      id,
      business,
      conversation,
      contact,
      direction,
      direction === 'inbound' ? 'customer' : 'ai',
      direction === 'inbound' ? `inbound:${id}` : `recovery:${id}`,
    ],
  );
  return id;
}
async function status(id: string) {
  return (
    await db.query<{ status: string; error_code: string | null }>(
      'select status,error_code from public.messages where business_id=$1 and id=$2',
      [business, id],
    )
  ).rows[0];
}

describe('worker flows on the actual migrated PostgreSQL schema', () => {
  it('persists intent, reserves budget, submits once, and clears dispatch lease', async () => {
    const id = await message();
    await dispatchMessage(business, id);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect((await status(id)).status).toBe('submitted');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from public.usage_events where business_id=$1',
          [business],
        )
      ).rows[0].status,
    ).toBe('settled');
    await dispatchMessage(business, id);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.query<{ dispatching_until: Date | null }>(
          'select dispatching_until from public.conversations where id=$1',
          [conversation],
        )
      ).rows[0].dispatching_until,
    ).toBe(null);
  });
  it('STOP after enqueue blocks provider dispatch and keeps enquiry for callback', async () => {
    const id = await message();
    await db.query(
      "insert into public.suppressions(business_id,contact_id,reason) values($1,$2,'customer_stop')",
      [business, contact],
    );
    await dispatchMessage(business, id);
    expect(fake.send).not.toHaveBeenCalled();
    expect((await status(id)).error_code).toBe('opted_out');
    expect(
      (await db.query<{ status: string }>('select status from public.leads where id=$1', [lead]))
        .rows[0].status,
    ).toBe('needs_callback');
  });
  it('missing consent never sends or reserves usage', async () => {
    const id = await message();
    await db.query('delete from public.consents where business_id=$1', [business]);
    await dispatchMessage(business, id);
    expect(fake.send).not.toHaveBeenCalled();
    expect((await status(id)).error_code).toBe('consent_required');
    expect((await db.query('select id from public.usage_events')).rows).toHaveLength(0);
  });
  it('human takeover after enqueue prevents the AI send', async () => {
    const id = await message();
    await db.query("update public.conversations set mode='human' where id=$1", [conversation]);
    await dispatchMessage(business, id);
    expect(fake.send).not.toHaveBeenCalled();
    expect((await status(id)).error_code).toBe('human_takeover');
  });
  it('provider timeout remains unknown and cannot be retried blindly', async () => {
    fake.send.mockRejectedValueOnce(new Error('timeout after possible acceptance'));
    const id = await message();
    await dispatchMessage(business, id);
    expect((await status(id)).status).toBe('unknown');
    await dispatchMessage(business, id);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(
      (await db.query<{ status: string }>('select status from public.usage_events')).rows[0].status,
    ).toBe('unknown');
  });
  it('expired entitlement blocks queued sends while still saving enquiry', async () => {
    const id = await message();
    await db.query(
      "update public.entitlements set valid_until=now()-interval '1 minute' where business_id=$1",
      [business],
    );
    await dispatchMessage(business, id);
    expect(fake.send).not.toHaveBeenCalled();
    expect((await status(id)).error_code).toBe('automation_paused');
  });
  it('cancellation after enqueue blocks SMS even if a stale entitlement is enabled', async () => {
    const id = await message();
    await db.query("update public.businesses set state='canceled' where id=$1", [business]);
    await dispatchMessage(business, id);
    expect(fake.send).not.toHaveBeenCalled();
    expect((await status(id)).error_code).toBe('automation_paused');
  });
  it('takeover during model processing prevents an AI reply', async () => {
    const id = await message('inbound');
    fake.qualify.mockImplementationOnce(async () => {
      await db.query("update public.conversations set mode='human' where id=$1", [conversation]);
      return {
        service: 'Roof repair',
        zip: '75201',
        urgent: false,
        summary: 'Synthetic roof leak',
      };
    });
    await qualifyMessage(business, id, conversation);
    expect(fake.qualify).toHaveBeenCalledOnce();
    expect(
      (await db.query("select id from public.messages where direction='outbound'")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query<{ status: string }>('select status from private.ai_runs')).rows[0].status,
    ).toBe('completed');
  });
  it('duplicate signed call event cannot create duplicate recovery messages', async () => {
    const eventId = randomUUID();
    const payload = {
      CallSid: `CA${'3'.repeat(32)}`,
      DialCallSid: `CA${'4'.repeat(32)}`,
      DialCallStatus: 'no-answer',
      From: '+12145550188',
      To: '+12145550187',
      _phoneNumberId: phoneId,
    };
    await db.query(
      "insert into public.webhook_events(id,business_id,provider,event_key,payload) values($1,$2,'twilio','call-fixture',$3::jsonb)",
      [eventId, business, JSON.stringify(payload)],
    );
    await processTwilioEvent(business, eventId, 'twilio.call_status');
    await processTwilioEvent(business, eventId, 'twilio.call_status');
    expect(
      (await db.query("select id from public.messages where direction='outbound'")).rows,
    ).toHaveLength(1);
    expect((await db.query('select id from public.calls')).rows).toHaveLength(1);
    expect((await db.query('select id from public.call_legs')).rows).toHaveLength(1);
    expect(
      (await db.query("select id from public.outbox where topic='sms.send'")).rows,
    ).toHaveLength(1);
  });
});

describe('billing and booking server entitlements', () => {
  async function mappedCustomer() {
    await db.query(
      "update public.subscriptions set provider_customer_id='cus_fixture',provider_subscription_id='sub_fixture' where business_id=$1",
      [business],
    );
  }
  it('late refund creates a sticky hold and later paid reconciliation cannot resume it', async () => {
    await mappedCustomer();
    await db.query(
      'update public.subscriptions set last_event_created_at=now() where business_id=$1',
      [business],
    );
    const eventId = randomUUID();
    await db.query(
      "insert into public.webhook_events(id,business_id,provider,event_key,payload) values($1,$2,'stripe','refund-fixture',$3::jsonb)",
      [
        eventId,
        business,
        JSON.stringify({ type: 'charge.refunded', created: Math.floor(Date.now() / 1000) - 86400 }),
      ],
    );
    await reconcileBilling(business, eventId);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ automation_enabled: boolean }>(
          'select automation_enabled from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0].automation_enabled,
    ).toBe(false);
    expect(
      (
        await db.query<{ review_required_at: Date | null }>(
          'select review_required_at from public.subscriptions where business_id=$1',
          [business],
        )
      ).rows[0].review_required_at,
    ).not.toBe(null);
  });
  it('administrator pause stays in force after positive paid provider state', async () => {
    await mappedCustomer();
    await db.query(
      "update public.businesses set automation_hold_at=now(),state='automation_paused' where id=$1",
      [business],
    );
    await db.query('update public.entitlements set automation_enabled=false where business_id=$1', [
      business,
    ]);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ automation_enabled: boolean }>(
          'select automation_enabled from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0].automation_enabled,
    ).toBe(false);
  });
  it('zero-value trial invoice never grants paid access', async () => {
    await mappedCustomer();
    await db.query("update public.businesses set state='automation_paused' where id=$1", [
      business,
    ]);
    await db.query('update public.entitlements set automation_enabled=false where business_id=$1', [
      business,
    ]);
    const result = await fake.subscriptions();
    result.data[0].latest_invoice.amount_paid = 0;
    fake.subscriptions.mockResolvedValueOnce(result);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ automation_enabled: boolean }>(
          'select automation_enabled from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0].automation_enabled,
    ).toBe(false);
  });
  it('recovering a past-due payment in the same period cannot reset usage caps', async () => {
    await mappedCustomer();
    const start = Math.floor(Date.now() / 1000) - 86400;
    await db.query(
      "update public.entitlements set plan_kind='paid',period_start=$2,sms_used=50,ai_used=40 where business_id=$1",
      [business, new Date(start * 1000)],
    );
    await db.query("update public.subscriptions set status='past_due' where business_id=$1", [
      business,
    ]);
    const result = await fake.subscriptions();
    result.data[0].items.data[0].current_period_start = start;
    fake.subscriptions.mockResolvedValueOnce(result);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ sms_used: number; ai_used: number }>(
          'select sms_used,ai_used from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ sms_used: 50, ai_used: 40 });
  });
  it('a verified new paid period resets its allowances once', async () => {
    await mappedCustomer();
    await db.query(
      "update public.entitlements set period_start=now()-interval '31 days',sms_used=50,ai_used=40 where business_id=$1",
      [business],
    );
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ sms_used: number }>(
          'select sms_used from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0].sms_used,
    ).toBe(0);
    await db.query('update public.entitlements set sms_used=9 where business_id=$1', [business]);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ sms_used: number }>(
          'select sms_used from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0].sms_used,
    ).toBe(9);
  });
  it('first positive paid activation replaces trial caps with the approved paid500 allowances', async () => {
    await mappedCustomer();
    await db.query('update public.entitlements set sms_used=50,ai_used=40 where business_id=$1', [
      business,
    ]);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{
          sms_limit: number;
          ai_limit: number;
          sms_used: number;
          ai_used: number;
          plan_kind: string;
        }>(
          'select sms_limit,ai_limit,sms_used,ai_used,plan_kind from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ sms_limit: 500, ai_limit: 500, sms_used: 0, ai_used: 0, plan_kind: 'paid' });
  });
  it('same-period reconciliation preserves snapshotted caps despite server-plan setting changes', async () => {
    await mappedCustomer();
    const start = Math.floor(Date.now() / 1000);
    await db.query(
      "update public.entitlements set plan_kind='paid',period_start=$2,sms_limit=333,ai_limit=444,sms_used=50,ai_used=40 where business_id=$1",
      [business, new Date(start * 1000)],
    );
    vi.stubEnv('PLAN_PAID_SMS_LIMIT', '650');
    vi.stubEnv('PLAN_PAID_AI_LIMIT', '700');
    const result = await fake.subscriptions();
    result.data[0].items.data[0].current_period_start = start;
    fake.subscriptions.mockResolvedValueOnce(result);
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ sms_limit: number; ai_limit: number; sms_used: number; ai_used: number }>(
          'select sms_limit,ai_limit,sms_used,ai_used from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ sms_limit: 333, ai_limit: 444, sms_used: 50, ai_used: 40 });
  });
  it('an actual new paid period applies new approved caps and resets once', async () => {
    await mappedCustomer();
    await db.query(
      "update public.entitlements set plan_kind='paid',period_start=now()-interval '31 days',sms_limit=500,ai_limit=500,sms_used=50,ai_used=40 where business_id=$1",
      [business],
    );
    vi.stubEnv('PLAN_PAID_SMS_LIMIT', '650');
    vi.stubEnv('PLAN_PAID_AI_LIMIT', '700');
    await reconcileBilling(business);
    expect(
      (
        await db.query<{ sms_limit: number; ai_limit: number; sms_used: number; ai_used: number }>(
          'select sms_limit,ai_limit,sms_used,ai_used from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ sms_limit: 650, ai_limit: 700, sms_used: 0, ai_used: 0 });
  });
  it('a mismatched actual Stripe price pauses instead of granting paid access', async () => {
    await mappedCustomer();
    fake.prices.mockResolvedValueOnce({ ...fixturePrice(), unit_amount: 100 });
    await expect(reconcileBilling(business)).rejects.toThrow('Approved billing plan mismatch');
    expect(
      (
        await db.query<{ automation_enabled: boolean; sms_limit: number }>(
          'select automation_enabled,sms_limit from public.entitlements where business_id=$1',
          [business],
        )
      ).rows[0],
    ).toEqual({ automation_enabled: false, sms_limit: 100 });
  });
  it('scheduled reconciliation does not move the provider-event timestamp watermark', async () => {
    await mappedCustomer();
    const marker = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000);
    await db.query(
      'update public.subscriptions set last_event_created_at=$2 where business_id=$1',
      [business, marker],
    );
    await reconcileBilling(business);
    expect(
      new Date(
        (
          await db.query<{ last_event_created_at: Date }>(
            'select last_event_created_at from public.subscriptions where business_id=$1',
            [business],
          )
        ).rows[0].last_event_created_at,
      ).getTime(),
    ).toBe(marker.getTime());
  });
  it('calendar work queued before cancellation remains a callback request', async () => {
    vi.stubEnv('CALENDAR_ENABLED', 'true');
    const calendarId = randomUUID(),
      appointmentId = randomUUID();
    await db.query(
      "insert into public.calendar_connections(id,business_id,calendar_id,refresh_token_ciphertext,key_version,scopes) values($1,$2,'primary','synthetic','v1',array['synthetic'])",
      [calendarId, business],
    );
    await db.query(
      "insert into public.appointments(id,business_id,lead_id,calendar_connection_id,status,start_at,end_at,customer_confirmed_at,idempotency_key) values($1,$2,$3,$4,'pending',now()+interval '1 day',now()+interval '1 day 1 hour',now(),'booking-fixture')",
      [appointmentId, business, lead, calendarId],
    );
    await db.query("update public.businesses set state='canceled' where id=$1", [business]);
    await db.query('update public.entitlements set automation_enabled=false where business_id=$1', [
      business,
    ]);
    await bookAppointment(business, appointmentId);
    expect(fake.book).not.toHaveBeenCalled();
    expect(
      (
        await db.query<{ status: string }>('select status from public.appointments where id=$1', [
          appointmentId,
        ])
      ).rows[0].status,
    ).toBe('requested');
  });
});
