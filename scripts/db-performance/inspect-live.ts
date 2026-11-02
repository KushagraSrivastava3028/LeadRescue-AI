import { existsSync } from 'node:fs';
import pg from 'pg';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/** Metadata only: never print pg_stat_statements.query, bindings, URLs or secrets. */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.info(
      'DATABASE_URL is not configured. Live query frequency, slow-query and unused-index evidence is NOT VERIFIED.',
    );
    process.exitCode = 2;
    return;
  }
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    await client.query("set local statement_timeout='5s'");
    const reset = await client.query(
      'select stats_reset from pg_stat_database where datname=current_database()',
    );
    const indexes = await client.query(
      `select s.schemaname,s.relname as table_name,s.indexrelname as index_name,s.idx_scan,s.idx_tup_read,s.idx_tup_fetch,i.indisprimary,i.indisunique,i.indisvalid,pg_relation_size(s.indexrelid)::text bytes from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid where s.schemaname in ('public','private') order by s.idx_scan,s.relname,s.indexrelname`,
    );
    const extension = await client.query<{ schema: string }>(
      "select n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements'",
    );
    let statements: unknown[] = [];
    let mostFrequent: unknown[] = [];
    let slowestMean: unknown[] = [];
    if (extension.rows[0]) {
      const schema = extension.rows[0].schema.replace(/"/g, '""');
      statements = (
        await client.query(
          `select queryid::text,calls,total_exec_time,mean_exec_time,rows from "${schema}".pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) order by total_exec_time desc limit 25`,
        )
      ).rows;
      mostFrequent = (
        await client.query(
          `select queryid::text,calls,total_exec_time,mean_exec_time,rows from "${schema}".pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) order by calls desc limit 25`,
        )
      ).rows;
      slowestMean = (
        await client.query(
          `select queryid::text,calls,total_exec_time,mean_exec_time,rows from "${schema}".pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and calls>0 order by mean_exec_time desc limit 25`,
        )
      ).rows;
    }
    console.info(
      JSON.stringify(
        {
          scope: 'read-only metadata, no customer SQL text or parameter values',
          statisticsResetAt: reset.rows[0]?.stats_reset ?? null,
          pgStatStatementsAvailable: !!extension.rows[0],
          mostFrequent,
          slowestMean,
          highestTotalExecutionTime: statements,
          indexes: indexes.rows,
          note: 'idx_scan=0 means no recorded scans in the observed statistics window; it does not prove an index is never needed. Do not drop constraint indexes.',
        },
        null,
        2,
      ),
    );
    await client.query('rollback');
  } finally {
    await client.end().catch(() => undefined);
  }
}
main().catch(() => {
  console.error(
    'Read-only database inspection unavailable. No database URL, SQL text, provider error or credential was logged.',
  );
  process.exitCode = 1;
});
