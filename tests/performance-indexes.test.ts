import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createFixture, asTenant } from '../scripts/db-performance/fixture';
import {
  mainReadQueries,
  assertReadOnlySelect,
  businessId,
} from '../scripts/db-performance/queries';
import { readFile } from 'node:fs/promises';
import { proposedIndexes } from '../scripts/db-performance/indexes';
let db: PGlite;
beforeAll(async () => {
  ({ db } = await createFixture());
}, 60000);
afterAll(async () => {
  await db?.close();
});
describe('main-screen read baseline before index changes', () => {
  it('executes every inventoried SELECT without changing rows', async () => {
    await asTenant(db);
    for (const query of mainReadQueries.filter((q) => !/^(admin|worker)_/.test(q.id))) {
      assertReadOnlySelect(query.sql);
      const result = await db.query(query.sql, query.params);
      expect(result.rows).toBeInstanceOf(Array);
    }
    const count = await db.query<{ count: number }>(
      'select count(*)::int count from public.messages where business_id=$1',
      [businessId],
    );
    expect(count.rows[0].count).toBe(100);
    await db.exec('reset role');
    for (const query of mainReadQueries.filter((q) => /^(admin|worker)_/.test(q.id)))
      expect((await db.query(query.sql, query.params)).rows).toBeInstanceOf(Array);
  });
  it('denies another tenant under the same authenticated RLS session', async () => {
    await asTenant(db);
    expect(
      (
        await db.query(
          "select id from public.messages where business_id=md5('synthetic-business:2')::uuid",
        )
      ).rows,
    ).toEqual([]);
    await db.exec('reset role');
  });
  it('never permits mutation or arbitrary SELECT to enter EXPLAIN ANALYZE', () => {
    for (const sql of [
      'update public.messages set body=body',
      'delete from public.calls',
      'select public.enqueue_manual_message($1,$2,$3)',
      'select pg_advisory_lock(1)',
      `${mainReadQueries[0].sql}; delete from public.messages`,
    ])
      expect(() => assertReadOnlySelect(sql)).toThrow();
  });
  it('preserves every main-screen result and tenant boundary after concurrent indexes and rollback', async () => {
    const capture = async () => {
      const rows: unknown[][] = [];
      for (const query of mainReadQueries) {
        if (/^(admin|worker)_/.test(query.id)) await db.exec('reset role');
        else await asTenant(db);
        rows.push((await db.query(query.sql, query.params)).rows);
      }
      return rows;
    };
    const before = await capture();
    await db.exec('reset role');
    const migration = await readFile('supabase/migrations/0007_workspace_read_indexes.sql', 'utf8');
    for (const statement of migration.split('-- leadrescue:statement-break'))
      await db.exec(statement);
    const indexes = (
      await db.query<{ name: string; valid: boolean }>(
        'select c.relname name,i.indisvalid valid from pg_class c join pg_index i on i.indexrelid=c.oid where c.relname=any($1::text[])',
        [proposedIndexes.map((i) => i.name)],
      )
    ).rows;
    expect(indexes).toHaveLength(4);
    expect(indexes.every((index) => index.valid)).toBe(true);
    expect(await capture()).toEqual(before);
    await asTenant(db);
    expect(
      (
        await db.query(
          "select id from public.messages where business_id=md5('synthetic-business:2')::uuid",
        )
      ).rows,
    ).toEqual([]);
    await db.exec('reset role');
    for (const statement of (
      await readFile('supabase/rollback/0007_workspace_read_indexes.sql', 'utf8')
    ).split('-- leadrescue:statement-break'))
      await db.exec(statement);
    expect(
      (
        await db.query('select relname from pg_class where relname=any($1::text[])', [
          proposedIndexes.map((i) => i.name),
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await capture()).toEqual(before);
    await db.exec('reset role');
  });
});
