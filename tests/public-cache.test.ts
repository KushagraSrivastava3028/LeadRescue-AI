import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  user: {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'synthetic-a@example.test',
    email_confirmed_at: '2026-10-01T00:00:00Z',
  },
  active: true,
  role: 'owner',
  suspended: false,
  nextLevel: 'aal1',
  getUser: vi.fn(),
  checkSession: vi.fn(),
  assurance: vi.fn(),
}));

const workspaceId = '10000000-0000-4000-8000-000000000010';

function workspaceQuery(table: string) {
  const result = {
    data: table === 'memberships' ? [{ business_id: workspaceId }] : [],
    count: 0,
    error: null,
  };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    in: () => query,
    gte: () => query,
    like: () => query,
    not: () => query,
    maybeSingle: async () => ({
      data:
        table === 'memberships'
          ? { role: auth.role, business_id: workspaceId }
          : table === 'businesses'
            ? {
                id: workspaceId,
                name: 'Synthetic Roofing',
                timezone: 'America/Chicago',
                state: 'account_created',
                suspended_at: auth.suspended ? '2026-11-01T00:00:00Z' : null,
              }
            : null,
      error: null,
    }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

vi.mock('@/lib/server/supabase', () => ({
  createUserClient: async () => ({
    auth: {
      getUser: async () => {
        auth.getUser();
        return { data: { user: { ...auth.user } }, error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          auth.assurance();
          return { data: { currentLevel: 'aal1', nextLevel: auth.nextLevel }, error: null };
        },
      },
    },
    rpc: async (name: string) => {
      auth.checkSession(name);
      return { data: auth.active, error: null };
    },
    from: workspaceQuery,
  }),
  createServiceClient: () => ({ rpc: async () => ({ data: { allowed: true }, error: null }) }),
}));

import { createReadAuthorizationScope, requireUser } from '@/lib/server/authorization';
import { jsonResponse } from '@/lib/server/security';
import { proxy } from '@/proxy';
import { GET as readWorkspace } from '@/app/api/workspace/route';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined);
  auth.user.id = '10000000-0000-4000-8000-000000000001';
  auth.user.email = 'synthetic-a@example.test';
  auth.active = true;
  auth.role = 'owner';
  auth.suspended = false;
  auth.nextLevel = 'aal1';
  auth.getUser.mockClear();
  auth.checkSession.mockClear();
  auth.assurance.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('baseline cache safety boundaries', () => {
  it('never carries verified identity across independently authenticated requests', async () => {
    const first = await requireUser();
    auth.user.id = '20000000-0000-4000-8000-000000000001';
    auth.user.email = 'synthetic-b@example.test';
    const second = await requireUser();
    expect(first.user.id).not.toBe(second.user.id);
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(auth.checkSession).toHaveBeenCalledTimes(2);
  });

  it('serves two same-URL workspace reads to the correct separately verified identities', async () => {
    const firstResponse = await readWorkspace(
      new Request('http://127.0.0.1:3000/api/workspace', {
        headers: { Cookie: 'synthetic-visitor=a' },
      }),
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    const firstVerificationCalls = auth.getUser.mock.calls.length;
    expect(firstVerificationCalls).toBe(1);
    auth.user.id = '20000000-0000-4000-8000-000000000001';
    auth.user.email = 'synthetic-b@example.test';
    const secondResponse = await readWorkspace(
      new Request('http://127.0.0.1:3000/api/workspace', {
        headers: { Cookie: 'synthetic-visitor=b' },
      }),
    );
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(first.user.id).not.toBe(second.user.id);
    expect(first.user.email).toBe('synthetic-a@example.test');
    expect(second.user.email).toBe('synthetic-b@example.test');
    expect(firstResponse.headers.get('cache-control')).toContain('private, no-store');
    expect(secondResponse.headers.get('cache-control')).toContain('private, no-store');
    expect(auth.getUser.mock.calls.length).toBe(firstVerificationCalls * 2);
  });

  it('checks revoked sessions again after an earlier allowed request', async () => {
    await expect(requireUser()).resolves.toHaveProperty('user.id', auth.user.id);
    auth.active = false;
    await expect(requireUser()).rejects.toMatchObject({ code: 'session_revoked', status: 401 });
  });

  it('does not reuse an old MFA decision after assurance requirements change', async () => {
    await requireUser();
    auth.nextLevel = 'aal2';
    await expect(requireUser()).rejects.toMatchObject({ code: 'mfa_required', status: 403 });
  });

  it('keeps private JSON and errors out of shared HTTP caches', () => {
    for (const status of [200, 401, 403, 429, 500, 503]) {
      const response = jsonResponse({ fixture: 'synthetic' }, status);
      expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('vary')).toContain('Cookie');
    }
  });

  it.each([
    '/',
    '/pricing',
    '/signin',
    '/app',
    '/admin',
    '/demo',
    '/api/workspace',
    '/auth/callback',
    '/api/webhooks/twilio/sms',
  ])('does not share CSP-nonce HTML or private API content at %s', async (path) => {
    const response = await proxy(new NextRequest(`http://127.0.0.1:3000${path}`));
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('request-lifetime verified identity cache', () => {
  it('deduplicates concurrent identity verification only within one read scope', async () => {
    const firstRequest = createReadAuthorizationScope();
    const [a, b, c] = await Promise.all([
      firstRequest.requireUser(),
      firstRequest.requireUser(),
      firstRequest.requireUser(),
    ]);
    expect(a.user.id).toBe(b.user.id);
    expect(b.user.id).toBe(c.user.id);
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.checkSession).toHaveBeenCalledTimes(1);
    expect(auth.assurance).toHaveBeenCalledTimes(1);
    await createReadAuthorizationScope().requireUser();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it('evicts failed verification and never turns a denial into cached success', async () => {
    const scope = createReadAuthorizationScope();
    auth.active = false;
    await expect(scope.requireUser()).rejects.toMatchObject({ code: 'session_revoked' });
    auth.active = true;
    await expect(scope.requireUser()).resolves.toHaveProperty('user.id', auth.user.id);
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    auth.active = false;
    await expect(createReadAuthorizationScope().requireUser()).rejects.toMatchObject({
      code: 'session_revoked',
    });
  });

  it('keeps role and business suspension decisions outside the identity cache', async () => {
    const scope = createReadAuthorizationScope();
    await expect(scope.requireMembership(workspaceId, 'profile')).resolves.toHaveProperty(
      'role',
      'owner',
    );
    auth.role = 'viewer';
    await expect(scope.requireMembership(workspaceId, 'profile')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    auth.suspended = true;
    await expect(scope.requireMembership(workspaceId)).rejects.toMatchObject({
      code: 'workspace_unavailable',
      status: 403,
    });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it('checks MFA again when the next HTTP request starts', async () => {
    await createReadAuthorizationScope().requireUser();
    auth.nextLevel = 'aal2';
    await expect(createReadAuthorizationScope().requireUser()).rejects.toMatchObject({
      code: 'mfa_required',
      status: 403,
    });
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });
});
