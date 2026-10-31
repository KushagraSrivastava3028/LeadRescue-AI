import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PgBoss, fromPglite } from 'pg-boss';

// Real pg-boss SQL on PostgreSQL WASM; no Redis, TCP database, or provider traffic.
let db: PGlite;
let boss: PgBoss;
const options = () => ({
  db: fromPglite(db),
  schema: 'queue_test',
  schedule: false,
  supervise: false,
});
beforeAll(async () => {
  db = await PGlite.create();
  boss = new PgBoss(options());
  boss.on('error', () => {});
  await boss.start();
  await boss.createQueue('test-fifo', { policy: 'key_strict_fifo' });
  await db.exec(
    'create table test_outbox(id uuid primary key,processed boolean not null default false)',
  );
}, 30000);
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await db?.close();
});

describe('durable outbox and queue integration', () => {
  it('rolls back queue publication with the outbox transaction', async () => {
    const id = randomUUID();
    await db.query('insert into test_outbox(id) values($1)', [id]);
    await db.exec('begin');
    await boss.send(
      'test-fifo',
      { businessId: 'tenant-a' },
      {
        id,
        singletonKey: 'tenant-a',
        db: { executeSql: async (sql, values) => ({ rows: (await db.query(sql, values)).rows }) },
      },
    );
    await db.query('update test_outbox set processed=true where id=$1', [id]);
    await db.exec('rollback');
    expect(
      (
        await db.query<{ processed: boolean }>('select processed from test_outbox where id=$1', [
          id,
        ])
      ).rows[0].processed,
    ).toBe(false);
    expect(await boss.getJobById('test-fifo', id)).toBe(null);
  });
  it('deduplicates a replayed committed outbox job ID', async () => {
    const id = randomUUID();
    expect(await boss.send('test-fifo', { value: 1 }, { id, singletonKey: 'dedup' })).toBe(id);
    expect(await boss.send('test-fifo', { value: 1 }, { id, singletonKey: 'dedup' })).toBe(null);
    const jobs = await boss.fetch<{ value: number }>('test-fifo');
    expect(jobs.filter((j) => j.id === id)).toHaveLength(1);
    await boss.complete(
      'test-fifo',
      jobs.map((j) => j.id),
    );
  });
  it('serializes each tenant across fetchers while other tenants progress', async () => {
    const first = await boss.send('test-fifo', { n: 1 }, { singletonKey: 'tenant-fifo' });
    const second = await boss.send('test-fifo', { n: 2 }, { singletonKey: 'tenant-fifo' });
    const other = await boss.send('test-fifo', { n: 3 }, { singletonKey: 'tenant-other' });
    const a = await boss.fetch('test-fifo', { batchSize: 10 });
    expect(a.map((j) => j.id)).toContain(first);
    expect(a.map((j) => j.id)).toContain(other);
    expect(a.map((j) => j.id)).not.toContain(second);
    const b = await boss.fetch('test-fifo', { batchSize: 10 });
    expect(b.map((j) => j.id)).not.toContain(second);
    await boss.complete(
      'test-fifo',
      a.map((j) => j.id),
    );
    const c = await boss.fetch('test-fifo');
    expect(c[0].id).toBe(second);
    await boss.complete(
      'test-fifo',
      c.map((j) => j.id),
    );
  });
  it('retains queued jobs across worker instance restart', async () => {
    const id = await boss.send('test-fifo', { n: 4 }, { singletonKey: 'restart' });
    await boss.stop({ graceful: false });
    boss = new PgBoss(options());
    boss.on('error', () => {});
    await boss.start();
    const jobs = await boss.fetch('test-fifo');
    expect(jobs.map((j) => j.id)).toContain(id);
    await boss.complete(
      'test-fifo',
      jobs.map((j) => j.id),
    );
  });
});
