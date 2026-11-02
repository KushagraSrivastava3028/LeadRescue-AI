import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { databaseUrl } from './config';
import { applicationPoolSettings, assertSessionConnection, isWorkerProcess } from './pool-settings';

let pool: Pool | undefined;
export function providerDatabase(): Pool {
  if (!pool) {
    const connectionString = databaseUrl();
    if (isWorkerProcess())
      assertSessionConnection(
        connectionString,
        process.env.WORKER_DATABASE_CONNECTION_MODE || process.env.DATABASE_CONNECTION_MODE,
      );
    pool = new Pool({
      connectionString,
      ...applicationPoolSettings(),
      application_name: 'leadrescue',
      ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  }
  return pool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await providerDatabase().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await providerDatabase().query<T>(sql, params)).rows;
}
export async function closeProviderDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
