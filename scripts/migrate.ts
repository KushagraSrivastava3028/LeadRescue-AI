import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  applyVersionedMigration,
  assertMigrationConnection,
  MigrationReviewRequired,
} from './migration-runner';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
async function main() {
  const connection = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connection)
    throw new Error('DATABASE_URL is required. Use a restricted operator session for migrations.');
  assertMigrationConnection(
    connection,
    process.env.MIGRATION_DATABASE_URL ? 'direct' : process.env.DATABASE_CONNECTION_MODE,
  );
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
      if (await applyVersionedMigration(client, name, sql)) console.info(`Applied ${name}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(734202610)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  if (error instanceof MigrationReviewRequired) console.error(error.message);
  console.error(
    'Migration failed. Review migration status with the operator; database details are redacted.',
  );
  process.exitCode = 1;
});
