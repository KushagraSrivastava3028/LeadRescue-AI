import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/testing/environment/route';
afterEach(() => vi.unstubAllEnvs());
describe('nonproduction read-only load-test admission', () => {
  it('stays hidden without explicit opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOAD_TESTING_ENABLED', 'false');
    expect((await GET()).status).toBe(404);
  });
  it('refuses production even when testing is requested', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEPLOYMENT_ENV', 'production');
    vi.stubEnv('LOAD_TESTING_ENABLED', 'true');
    expect((await GET()).status).toBe(404);
  });
  it('admits explicitly isolated staging but never paid integrations', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEPLOYMENT_ENV', 'staging');
    vi.stubEnv('LOAD_TESTING_ENABLED', 'true');
    for (const key of [
      'TWILIO_ENABLED',
      'AI_ENABLED',
      'BILLING_ENABLED',
      'CALENDAR_ENABLED',
      'NOTIFICATIONS_ENABLED',
    ])
      vi.stubEnv(key, 'false');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      environment: 'staging',
      paidIntegrationsDisabled: true,
      loadTestingEnabled: true,
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    vi.stubEnv('AI_ENABLED', 'true');
    expect((await GET()).status).toBe(404);
  });
});
