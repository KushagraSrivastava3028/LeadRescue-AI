import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyVersionedMigration,
  assertMigrationConnection,
  parseMigration,
  type MigrationSqlClient,
} from '../scripts/migration-runner';
let db: PGlite;
let commands: string[];
let client: MigrationSqlClient;
beforeEach(async () => {
  db = await PGlite.create();
  commands = [];
  await db.exec(
    'create schema private;create table private.schema_migrations(name text primary key,sha256 text not null);create table public.sample(id integer primary key,business_id integer not null,created_at timestamptz not null default now())',
  );
  client = {
    query: async (sql, params) => {
      commands.push(sql);
      if (params || /^select/i.test(sql.trim())) return db.query(sql, params);
      const result = await db.exec(sql);
      return { rows: (result.at(-1)?.rows as Record<string, unknown>[]) || [] };
    },
  };
});
afterEach(async () => db.close());
const concurrent =
  '-- leadrescue:no-transaction\ncreate index concurrently if not exists sample_business_created_idx on public.sample (business_id, created_at desc);';
describe('versioned migration safety', () => {
  it('keeps an ordinary migration and its ledger atomic on failure', async () => {
    await expect(
      applyVersionedMigration(
        client,
        '0001_failure.sql',
        'insert into public.sample(id,business_id) values(1,1); select * from public.missing_table;',
      ),
    ).rejects.toBeDefined();
    expect((await db.query('select * from public.sample')).rows).toHaveLength(0);
    expect((await db.query('select * from private.schema_migrations')).rows).toHaveLength(0);
    expect(commands).toContain('rollback');
  });
  it('executes concurrent builds individually outside a transaction and skips identical applied versions', async () => {
    expect(await applyVersionedMigration(client, '0002_indexes.sql', concurrent)).toBe(true);
    expect(commands).not.toContain('begin');
    expect((await db.query('select * from private.schema_migrations')).rows).toHaveLength(1);
    expect(await applyVersionedMigration(client, '0002_indexes.sql', concurrent)).toBe(false);
    await expect(
      applyVersionedMigration(client, '0002_indexes.sql', concurrent + '\n-- modified'),
    ).rejects.toThrow('changed');
  });
  it('recovers a partial concurrent build without repeating the completed index', async () => {
    const sql =
      concurrent +
      '\n-- leadrescue:statement-break\ncreate index concurrently if not exists sample_created_idx on public.sample (created_at);';
    let fail = true;
    const delegated = client.query.bind(client);
    client.query = async (text, params) => {
      if (fail && /^create index.*sample_created_idx/i.test(text)) {
        fail = false;
        throw new Error('synthetic interrupted build');
      }
      return delegated(text, params);
    };
    await expect(applyVersionedMigration(client, '0003_partial.sql', sql)).rejects.toThrow();
    expect((await db.query('select * from private.schema_migrations')).rows).toHaveLength(0);
    expect(await applyVersionedMigration(client, '0003_partial.sql', sql)).toBe(true);
    expect(
      commands.filter(
        (c) => c.startsWith('create index') && c.includes('sample_business_created_idx'),
      ),
    ).toHaveLength(1);
  });
  it('refuses an invalid existing index and a reused name with the wrong definition', async () => {
    await db.exec('create index sample_business_created_idx on public.sample (id)');
    await expect(applyVersionedMigration(client, '0004_wrong.sql', concurrent)).rejects.toThrow(
      'differs',
    );
    const delegated = client.query.bind(client);
    client.query = async (sql, params) => {
      const result = await delegated(sql, params);
      if (sql.includes('pg_catalog.pg_index') && result.rows[0]) result.rows[0].indisvalid = false;
      return result;
    };
    await expect(applyVersionedMigration(client, '0005_invalid.sql', concurrent)).rejects.toThrow(
      'invalid',
    );
  });
  it('rejects unreviewed multi-command concurrent blocks and transaction pooling', () => {
    expect(() => parseMigration(concurrent + ' delete from public.sample;')).toThrow();
    expect(() => assertMigrationConnection('postgresql://inert@127.0.0.1:6543/local')).toThrow();
    expect(() =>
      assertMigrationConnection('postgresql://inert@127.0.0.1:5432/local', 'transaction'),
    ).toThrow();
  });
});
