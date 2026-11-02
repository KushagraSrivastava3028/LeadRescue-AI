import 'server-only';
import { CapabilityUnavailable } from './config';

function bounded(name: string, fallback: number, ceiling: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > ceiling)
    throw new CapabilityUnavailable(name);
  return Number(value);
}

export function isWorkerProcess(): boolean {
  return process.env.LEADRESCUE_PROCESS_KIND === 'worker';
}

/** Connections are process resources, not sessions or cached customer records. */
export function applicationPoolSettings() {
  const runtime = process.env.APPLICATION_RUNTIME || 'persistent';
  if (!['persistent', 'serverless'].includes(runtime))
    throw new CapabilityUnavailable('APPLICATION_RUNTIME');
  const worker = isWorkerProcess();
  const name = worker ? 'WORKER_DB_POOL_MAX' : 'DB_POOL_MAX';
  return {
    max: bounded(name, worker ? 10 : runtime === 'serverless' ? 1 : 10, 50),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  };
}

export function queuePoolMax(): number {
  return bounded('QUEUE_DB_POOL_MAX', 5, 20);
}

/** Queue polling/installation and migration advisory locks need stable sessions. */
export function assertSessionConnection(connectionString: string, declaredMode?: string): void {
  let port: string;
  try {
    port = new URL(connectionString).port;
  } catch {
    throw new CapabilityUnavailable('DATABASE_URL');
  }
  if (declaredMode && !['direct', 'session', 'transaction'].includes(declaredMode))
    throw new CapabilityUnavailable('DATABASE_CONNECTION_MODE');
  if (declaredMode === 'transaction' || port === '6543')
    throw new CapabilityUnavailable('Direct or session database connection for worker/migrations');
}
