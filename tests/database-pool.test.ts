import { afterEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      fake.configs.push(config);
    }
    query = fake.query;
    end = fake.end;
    async connect() {
      return { query: fake.query, release: fake.release };
    }
  },
}));
vi.mock('@/lib/server/providers/config', () => ({
  databaseUrl: () => 'postgresql://synthetic:inert@127.0.0.1:5432/synthetic',
  CapabilityUnavailable: class extends Error {},
}));
import {
  closeProviderDatabase,
  providerDatabase,
  query,
  transaction,
} from '@/lib/server/providers/database';
import {
  applicationPoolSettings,
  assertSessionConnection,
  queuePoolMax,
} from '@/lib/server/providers/pool-settings';
afterEach(async () => {
  await closeProviderDatabase();
  fake.configs.length = 0;
  fake.query.mockReset().mockResolvedValue({ rows: [] });
  fake.release.mockClear();
  vi.unstubAllEnvs();
});
describe('existing database connection behavior before scaling', () => {
  it('reuses one bounded pool per process and verifies TLS in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(providerDatabase()).toBe(providerDatabase());
    expect(fake.configs).toHaveLength(1);
    expect(fake.configs[0]).toMatchObject({
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: true },
    });
  });
  it('keeps values parameterized without persistent named prepared statements', async () => {
    const value = "untrusted '; drop table leads; --";
    await query('select id from public.leads where business_id=$1', [value]);
    expect(fake.query).toHaveBeenCalledWith('select id from public.leads where business_id=$1', [
      value,
    ]);
    expect(fake.query.mock.calls[0][0]).toBeTypeOf('string');
  });
  it('pins a client for a transaction and releases it after rollback', async () => {
    const failure = new Error('synthetic failure');
    await expect(
      transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(fake.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
describe('deployment connection budgets', () => {
  it('defaults serverless raw SQL adapters to one connection', () => {
    vi.stubEnv('APPLICATION_RUNTIME', 'serverless');
    expect(applicationPoolSettings().max).toBe(1);
  });
  it('allows bounded per-process tuning and separates worker pools', () => {
    vi.stubEnv('DB_POOL_MAX', '3');
    expect(applicationPoolSettings().max).toBe(3);
    vi.stubEnv('LEADRESCUE_PROCESS_KIND', 'worker');
    vi.stubEnv('WORKER_DB_POOL_MAX', '4');
    vi.stubEnv('QUEUE_DB_POOL_MAX', '2');
    expect(applicationPoolSettings().max).toBe(4);
    expect(queuePoolMax()).toBe(2);
  });
  it('rejects accidental unlimited or invalid connection budgets', () => {
    for (const max of ['0', '500', 'NaN', '1.5']) {
      vi.stubEnv('DB_POOL_MAX', max);
      expect(() => applicationPoolSettings()).toThrow();
    }
    vi.stubEnv('QUEUE_DB_POOL_MAX', '21');
    expect(queuePoolMax).toThrow();
  });
  it('does not let a session-dependent worker use a transaction pooler', () => {
    expect(() => assertSessionConnection('postgresql://inert@127.0.0.1:6543/test')).toThrow();
    expect(() =>
      assertSessionConnection('postgresql://inert@127.0.0.1:5432/test', 'transaction'),
    ).toThrow();
    expect(() =>
      assertSessionConnection('postgresql://inert@127.0.0.1:5432/test', 'session'),
    ).not.toThrow();
  });
});
