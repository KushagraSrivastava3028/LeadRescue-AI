import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createFixture, asTenant } from '../scripts/db-performance/fixture';
import { businessId, ownerId } from '../scripts/db-performance/queries';
import { industries } from '@/lib/industries';

let db: PGlite;
beforeAll(async () => {
  ({ db } = await createFixture('small', false));
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe('industry migration and tenant permissions on real PostgreSQL', () => {
  it('preserves existing services and leads and backfills the legacy roofing profile', async () => {
    const before = await db.query<{ services: string[] }>(
      'select services from public.business_profiles where business_id=$1',
      [businessId],
    );
    const leads = await db.query('select id,service,summary from public.leads order by id');
    await db.exec(await readFile('supabase/migrations/0008_multi_industry.sql', 'utf8'));
    const after = await db.query(
      'select industry,services,intake_questions,appointment_label from public.business_profiles where business_id=$1',
      [businessId],
    );
    expect(after.rows[0]).toEqual({
      industry: 'roofing',
      services: before.rows[0].services,
      intake_questions: [],
      appointment_label: 'Roof inspection',
    });
    expect(
      (await db.query('select id,service,summary from public.leads order by id')).rows,
    ).toEqual(leads.rows);
  });
  it('keeps SQL and UI presets in sync and refuses catalog writes by users', async () => {
    await asTenant(db);
    const rows = await db.query<{
      id: string;
      services: string[];
      intake_questions: string[];
      appointment_label: string;
    }>('select * from public.industry_presets');
    for (const p of industries)
      expect(rows.rows.find((r) => r.id === p.id)).toEqual({
        id: p.id,
        services: p.services,
        intake_questions: p.intakeQuestions,
        appointment_label: p.appointmentLabel,
      });
    await expect(
      db.query("update public.industry_presets set appointment_label='Forged' where id='plumbing'"),
    ).rejects.toThrow();
  });
  it('allows owners to save custom settings without rewriting existing enquiries', async () => {
    await asTenant(db);
    await db.query(
      "update public.business_profiles set industry='custom',services=array['Appliance repair'],intake_questions=array['Which appliance needs attention?'],appointment_label='Diagnostic visit' where business_id=$1",
      [businessId],
    );
    expect(
      (
        await db.query(
          'select industry,services,appointment_label from public.business_profiles where business_id=$1',
          [businessId],
        )
      ).rows[0],
    ).toMatchObject({
      industry: 'custom',
      services: ['Appliance repair'],
      appointment_label: 'Diagnostic visit',
    });
    expect(
      (
        await db.query(
          "update public.business_profiles set industry='plumbing' where business_id<>$1 returning business_id",
          [businessId],
        )
      ).rows,
    ).toEqual([]);
  });
  it('rejects invalid industry, oversized questions and forged staff updates', async () => {
    await db.exec('reset role');
    for (const sql of [
      "update public.business_profiles set industry='invalid' where business_id=$1",
      "update public.business_profiles set intake_questions=array[repeat('x',201)] where business_id=$1",
      "update public.business_profiles set intake_questions=array['one','two','three','four'] where business_id=$1",
      "update public.business_profiles set appointment_label='' where business_id=$1",
    ])
      await expect(db.query(sql, [businessId])).rejects.toThrow();
    const staffId = 'a2000000-0000-4000-8000-000000000099';
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'staff-industry@example.test',now())",
      [staffId],
    );
    await db.query('insert into auth.sessions(id,user_id) values($1,$1)', [staffId]);
    await db.query(
      "insert into public.memberships(business_id,user_id,role) values($1,$2,'staff')",
      [businessId, staffId],
    );
    await asTenant(db);
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [staffId, JSON.stringify({ sub: staffId, session_id: staffId, aal: 'aal1' })],
    );
    expect(
      (
        await db.query(
          "update public.business_profiles set industry='hvac' where business_id=$1 returning business_id",
          [businessId],
        )
      ).rows,
    ).toEqual([]);
    await db.exec('reset role');
  });
  it('creates new industries atomically and keeps the existing activation gate', async () => {
    await asTenant(db);
    const created = await db.query<{ id: string }>(
      "select public.create_business_for_industry('Acme Plumbing','America/Chicago',array['75201'],'plumbing') id",
    );
    const id = created.rows[0].id;
    expect(
      (
        await db.query(
          'select industry,services,intake_questions,appointment_label from public.business_profiles where business_id=$1',
          [id],
        )
      ).rows[0],
    ).toMatchObject({
      industry: 'plumbing',
      services: industries[1].services,
      intake_questions: industries[1].intakeQuestions,
      appointment_label: 'Plumbing assessment',
    });
    expect(
      (
        await db.query<{ automation_enabled: boolean }>(
          'select automation_enabled from public.entitlements where business_id=$1',
          [id],
        )
      ).rows[0].automation_enabled,
    ).toBe(false);
    await expect(
      db.query(
        "select public.create_business_for_industry('Invalid','America/Chicago',array['75201'],'unknown')",
      ),
    ).rejects.toThrow();
    await db.exec('reset role');
    await db.query('delete from auth.sessions where user_id=$1', [ownerId]);
    await asTenant(db);
    await expect(
      db.query(
        "select public.create_business_for_industry('Revoked','America/Chicago',array['75201'],'cleaning')",
      ),
    ).rejects.toThrow();
  });
});
