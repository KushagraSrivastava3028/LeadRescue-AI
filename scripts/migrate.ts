import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
async function main() {
  const connection = process.env.DATABASE_URL;
  if (!connection)
    throw new Error('DATABASE_URL is required. Use a restricted operator session for migrations.');
  const pool = new pg.Pool({
    connectionString: connection,
    max: 1,
    ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(734202610)');
    await client.query(
      'create schema if not exists private; create table if not exists private.schema_migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now()); revoke all on table private.schema_migrations from public',
    );
    for (const name of readdirSync(resolve('supabase/migrations'))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort()) {
      const sql = readFileSync(resolve('supabase/migrations', name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        'select sha256 from private.schema_migrations where name=$1',
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== digest)
          throw new Error(`Migration changed after application: ${name}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into private.schema_migrations(name,sha256) values($1,$2)', [
          name,
          digest,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      console.info(`Applied ${name}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(734202610)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    'Migration failed. Review migration status with the operator; database details are redacted.',
  );
  process.exitCode = 1;
});
