import 'server-only';
import { existsSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { databaseUrl } from '../lib/server/providers/config';
import { closeProviderDatabase, query } from '../lib/server/providers/database';

// Offline operator utility. Run only with a restricted worker database role from
// an audited operator session; never expose it as an unauthenticated HTTP route.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
async function main() {
  if (process.env.OPERATOR_MAINTENANCE_ENABLED !== 'true' || !process.env.OPERATOR_ID)
    throw new Error('Restricted operator session required');
  const action = z.enum(['inspect', 'retry']).parse(process.argv[2]);
  const businessId = z.string().uuid().parse(process.argv[3]);
  const boss = new PgBoss({
    connectionString: databaseUrl(),
    schema: 'pgboss',
    migrate: false,
    schedule: false,
    supervise: false,
    ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await boss.start();
    if (action === 'inspect') {
      const rows = await query<{
        job_id: string;
        status: string;
        error_code: string | null;
        created_at: Date;
      }>(
        'select job_id,status,error_code,created_at from public.job_attempts where business_id=$1 order by created_at desc limit 30',
        [businessId],
      );
      console.info(JSON.stringify({ businessId, attempts: rows }));
    } else {
      const jobId = z.string().uuid().parse(process.argv[4]);
      const [source] = await query('select id from public.outbox where business_id=$1 and id=$2', [
        businessId,
        jobId,
      ]);
      if (!source) throw new Error('Scoped job unavailable');
      const job = await boss.getJobById<{ businessId: string }>('leadrescue-events', jobId);
      if (job?.data.businessId !== businessId || job.state !== 'failed')
        throw new Error('Only the scoped failed head may be retried');
      await boss.retry('leadrescue-events', jobId);
      await query(
        "insert into public.audit_logs(business_id,action,metadata) values($1,'worker.job.retry',$2::jsonb)",
        [businessId, JSON.stringify({ jobId, operator: process.env.OPERATOR_ID.slice(0, 120) })],
      );
      console.info(JSON.stringify({ status: 'retry_requested', jobId }));
    }
  } finally {
    await boss.stop({ graceful: false });
    await closeProviderDatabase();
  }
}
main().catch(() => {
  console.error(JSON.stringify({ status: 'operation_rejected' }));
  process.exitCode = 1;
});
