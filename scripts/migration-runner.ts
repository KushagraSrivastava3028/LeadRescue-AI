import { createHash } from 'node:crypto';
export interface MigrationSqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export class MigrationReviewRequired extends Error {}
const directive = '-- leadrescue:no-transaction';
const separator = /^\s*-- leadrescue:statement-break\s*$/m;

export function parseMigration(sql: string) {
  const concurrent = sql.split(/\r?\n/).some((line) => line.trim() === directive);
  if (!concurrent) return { concurrent: false, statements: [sql] };
  const statements = sql
    .split(separator)
    .map((block) => block.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim())
    .filter(Boolean);
  if (!statements.length) throw new MigrationReviewRequired('Empty concurrent migration');
  for (const statement of statements) {
    if (
      !/^create\s+index\s+concurrently\s+if\s+not\s+exists\s+[a-z_][a-z0-9_]*\s+on\s+public\.[a-z_][a-z0-9_]*\s*\([a-z0-9_,\s]+\)\s*;?$/i.test(
        statement,
      )
    )
      throw new MigrationReviewRequired(
        'Concurrent migrations must contain one reviewed CREATE INDEX per statement-break block',
      );
  }
  return { concurrent: true, statements };
}
function normalizeDefinition(value: string) {
  return value
    .toLowerCase()
    .replace(/\bconcurrently\s+/g, '')
    .replace(/\bif not exists\s+/g, '')
    .replace(/\busing btree\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/;$/, '')
    .trim();
}
async function verifyConcurrentIndex(client: MigrationSqlClient, statement: string) {
  const name = statement.match(
    /^create\s+index\s+concurrently\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)/i,
  )![1];
  const result = await client.query(
    'select i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) definition from pg_catalog.pg_index i where i.indexrelid=to_regclass($1)',
    [`public.${name}`],
  );
  const found = result.rows[0];
  if (
    found &&
    (!found.indisvalid ||
      !found.indisready ||
      normalizeDefinition(String(found.definition)) !== normalizeDefinition(statement))
  )
    throw new MigrationReviewRequired(
      `Index ${name} is invalid or differs from its migration. Review the concurrent rollback before retrying.`,
    );
  return Boolean(found);
}
export function assertMigrationConnection(connectionString: string, mode?: string) {
  if (new URL(connectionString).port === '6543' || mode === 'transaction')
    throw new MigrationReviewRequired(
      'Migrations need a dedicated direct/session connection, not transaction pooling.',
    );
}
/** Caller holds the session advisory lock. A concurrent DDL block commits independently. */
export async function applyVersionedMigration(
  client: MigrationSqlClient,
  name: string,
  sql: string,
) {
  if (!/^\d+_[a-z0-9_]+\.sql$/i.test(name))
    throw new MigrationReviewRequired('Invalid migration filename');
  const sha = createHash('sha256').update(sql).digest('hex');
  const existing = await client.query(
    'select sha256 from private.schema_migrations where name=$1',
    [name],
  );
  if (existing.rows.length) {
    if (existing.rows[0].sha256 !== sha)
      throw new MigrationReviewRequired(`Migration changed after application: ${name}`);
    return false;
  }
  const plan = parseMigration(sql);
  if (plan.concurrent) {
    await client.query("set lock_timeout = '5s'");
    try {
      for (const statement of plan.statements) {
        if (!(await verifyConcurrentIndex(client, statement))) await client.query(statement);
        if (!(await verifyConcurrentIndex(client, statement)))
          throw new MigrationReviewRequired('Concurrent index was not created');
      }
      await client.query('insert into private.schema_migrations(name,sha256) values($1,$2)', [
        name,
        sha,
      ]);
    } finally {
      await client.query('reset lock_timeout');
    }
  } else {
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into private.schema_migrations(name,sha256) values($1,$2)', [
        name,
        sha,
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
  return true;
}
