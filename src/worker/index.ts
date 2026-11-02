import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { databaseUrl } from '../lib/server/providers/config';
import { assertSessionConnection, queuePoolMax } from '../lib/server/providers/pool-settings';
import { closeProviderDatabase, query, transaction } from '../lib/server/providers/database';
import { processTwilioEvent } from './events';
import { dispatchMessage } from './dispatch';
import { qualifyMessage } from './qualify';
import { reconcileBilling } from './billing';
import { bookAppointment } from './calendar';
import { maintenance } from './maintenance';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true')
  throw new Error('Production worker refuses demo mode');
const workerId = randomUUID();
process.env.LEADRESCUE_PROCESS_KIND = 'worker';
assertSessionConnection(
  databaseUrl(),
  process.env.WORKER_DATABASE_CONNECTION_MODE || process.env.DATABASE_CONNECTION_MODE,
);
const QUEUE = 'leadrescue-events';
const jobSchema = z
  .object({
    outboxId: z.string().uuid(),
    businessId: z.string().uuid(),
    topic: z.string().max(80),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
type JobData = z.infer<typeof jobSchema>;
const boss = new PgBoss({
  connectionString: databaseUrl(),
  schema: 'pgboss',
  max: queuePoolMax(),
  application_name: 'leadrescue-worker',
  ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
});
let stopping = false;
let ticking = false;
let lastHealthy = 0;
let maintenanceAt = 0;
boss.on('error', () => {
  console.error(JSON.stringify({ event: 'queue_error' }));
});

async function handle(data: JobData): Promise<void> {
  const { businessId, topic } = data;
  // Trust identity only from the scoped durable outbox record, never from AI/provider payloads.
  const [source] = await query<{ topic: string; payload: unknown }>(
    'select topic,payload from public.outbox where business_id=$1 and id=$2',
    [businessId, data.outboxId],
  );
  if (!source || source.topic !== topic) throw new Error('Queue source unavailable');
  const payload = z.record(z.string(), z.unknown()).parse(source.payload);
  if (topic.startsWith('twilio.'))
    await processTwilioEvent(businessId, z.string().uuid().parse(payload.eventId), topic);
  else if (topic === 'sms.send')
    await dispatchMessage(businessId, z.string().uuid().parse(payload.messageId));
  else if (topic === 'ai.qualify')
    await qualifyMessage(
      businessId,
      z.string().uuid().parse(payload.messageId),
      z.string().uuid().parse(payload.conversationId),
    );
  else if (topic === 'stripe.event')
    await reconcileBilling(businessId, z.string().uuid().parse(payload.eventId));
  else if (topic === 'billing.reconcile') await reconcileBilling(businessId);
  else if (topic === 'calendar.book')
    await bookAppointment(businessId, z.string().uuid().parse(payload.appointmentId));
  else throw new Error('Unsupported queue topic');
}

async function publishOutbox(): Promise<void> {
  await transaction(async (db) => {
    const rows = await db.query<{
      id: string;
      business_id: string;
      topic: string;
      payload: Record<string, unknown>;
    }>(
      'select id,business_id,topic,payload from public.outbox where processed_at is null and available_at<=now() order by available_at,created_at,id for update skip locked limit 30',
    );
    for (const row of rows.rows) {
      // pg-boss and outbox share one PostgreSQL transaction. Crash cannot lose a committed event.
      await boss.send(
        QUEUE,
        { outboxId: row.id, businessId: row.business_id, topic: row.topic, payload: row.payload },
        {
          id: row.id,
          singletonKey: `business:${row.business_id}`,
          retryLimit: 5,
          retryDelay: 10,
          retryBackoff: true,
          expireInSeconds: 120,
          db: {
            executeSql: async (sql, values) => {
              const result = await db.query(sql, values);
              return { rows: result.rows };
            },
          },
        },
      );
      await db.query(
        'update public.outbox set processed_at=now(),attempts=attempts+1,locked_until=null where business_id=$1 and id=$2',
        [row.business_id, row.id],
      );
    }
  });
}

async function tick(): Promise<void> {
  if (stopping || ticking) return;
  ticking = true;
  try {
    await publishOutbox();
    if (Date.now() - maintenanceAt > 60000) {
      await maintenance();
      maintenanceAt = Date.now();
    }
    await query(
      'insert into private.worker_heartbeats(worker_id,last_seen_at) values($1,now()) on conflict(worker_id) do update set last_seen_at=excluded.last_seen_at',
      [workerId],
    );
    lastHealthy = Date.now();
  } catch {
    console.error(JSON.stringify({ event: 'worker_tick_failed' }));
  } finally {
    ticking = false;
  }
}

async function main() {
  await boss.start();
  // FIFO per business serializes all conversations, including webhook events with no conversation ID yet.
  await boss.createQueue('leadrescue-dead-letter');
  await boss.createQueue(QUEUE, {
    policy: 'key_strict_fifo',
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 120,
    deadLetter: 'leadrescue-dead-letter',
  });
  await boss.work<JobData>(QUEUE, { batchSize: 1, localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) {
      const data = jobSchema.parse(job.data);
      try {
        await handle(data);
        await query(
          "insert into public.job_attempts(business_id,outbox_id,job_id,status) values($1,$2,$3,'completed')",
          [data.businessId, data.outboxId, job.id],
        );
      } catch {
        await query(
          "insert into public.job_attempts(business_id,outbox_id,job_id,status,error_code) values($1,$2,$3,'failed','processing_failed')",
          [data.businessId, data.outboxId, job.id],
        );
        throw new Error('Job processing failed');
      }
    }
  });
  const timer = setInterval(() => {
    void tick();
  }, 2000);
  await tick();
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  const health = createServer((req, res) => {
    const ok = !stopping && Date.now() - lastHealthy < 30000;
    res.writeHead(req.url === '/health' ? (ok ? 200 : 503) : 404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({ status: req.url === '/health' ? (ok ? 'ok' : 'unavailable') : 'not_found' }),
    );
  }).listen(port, '0.0.0.0');
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    health.close();
    await boss.stop({ graceful: true, timeout: 30000 });
    await closeProviderDatabase();
  }
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
  console.info(JSON.stringify({ event: 'worker_started' }));
}
main().catch(() => {
  console.error(JSON.stringify({ event: 'worker_start_failed' }));
  process.exitCode = 1;
});
