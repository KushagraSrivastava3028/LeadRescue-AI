import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  membership: null as null | Record<string, unknown>,
  business: null as null | Record<string, unknown>,
  currentLevel: 'aal1',
  nextLevel: 'aal1',
  admin: false,
  active: true,
  rateAllowed: true,
  calls: [] as string[],
  authError: null as null | { status: number; code: string },
  mfaFactors: [] as { id: string; factor_type: string; status: string }[],
}));
vi.mock('@/lib/server/supabase', () => ({
  createUserClient: async () => ({
    auth: {
      signUp: async () => ({ data: { user: null }, error: state.authError }),
      getUser: async () => {
        state.calls.push('verify-user');
        return { data: { user: state.user }, error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: state.currentLevel, nextLevel: state.nextLevel },
          error: null,
        }),
        listFactors: async () => ({
          data: {
            all: state.mfaFactors,
            totp: state.mfaFactors.filter(
              (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
            ),
          },
          error: null,
        }),
        challengeAndVerify: async ({ factorId }: { factorId: string }) => {
          state.calls.push(`mfa:${factorId}`);
          return { data: {}, error: null };
        },
      },
    },
    from: (table: string) => {
      state.calls.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => ({
          data: table === 'memberships' ? state.membership : state.business,
          error: null,
        }),
      };
      return query;
    },
    rpc: async (name: string) => ({
      data:
        name === 'check_platform_admin'
          ? state.admin
          : name === 'check_active_session'
            ? state.active
            : null,
      error: null,
    }),
  }),
  createServiceClient: () => ({
    rpc: async () => ({ data: { allowed: state.rateAllowed, retry_after: 25 }, error: null }),
  }),
}));

import {
  assertSameOrigin,
  enforceRateLimit,
  errorResponse,
  HttpError,
  readJson,
  safeRedirectPath,
} from '@/lib/server/security';
import {
  requireMembership,
  requirePlatformAdmin,
  requireRecentSignIn,
  requireUser,
  roleCan,
} from '@/lib/server/authorization';
import { authSchema, workspaceMutationSchema } from '@/lib/validation';
import { getServerEnv } from '@/lib/server/env';
import { POST as mutateWorkspace } from '@/app/api/workspace/route';
import { POST as mutateAdmin } from '@/app/api/admin/route';
import { POST as mutateAuth } from '@/app/api/auth/route';

const businessId = '10000000-0000-4000-8000-000000000001';
const conversationId = '10000000-0000-4000-8000-000000000002';
const verified = {
  id: '10000000-0000-4000-8000-000000000003',
  email: 'synthetic@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: new Date().toISOString(),
  user_metadata: { role: 'admin' },
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('TRUST_PROXY', 'false');
  state.user = null;
  state.membership = null;
  state.business = null;
  state.currentLevel = 'aal1';
  state.nextLevel = 'aal1';
  state.admin = false;
  state.active = true;
  state.rateAllowed = true;
  state.calls = [];
  state.authError = null;
  state.mfaFactors = [];
});

describe('HTTP input boundary', () => {
  const request = (body: string, extra: HeadersInit = {}) =>
    new Request('http://localhost:3000/api/workspace', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...extra },
      body,
    });
  it('rejects cross-origin JSON before parsing or side effects', async () => {
    await expect(
      readJson(request('{}', { origin: 'https://attacker.example' }), z.object({})),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.calls).toEqual([]);
  });
  it('rejects form content and absent Origin', async () => {
    await expect(
      readJson(
        request('{}', { 'content-type': 'application/x-www-form-urlencoded' }),
        z.object({}),
      ),
    ).rejects.toMatchObject({ status: 415 });
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/workspace'))).toThrow(
      HttpError,
    );
  });
  it('rejects chunked oversized input even without Content-Length', async () => {
    await expect(
      readJson(
        request(JSON.stringify({ body: 'x'.repeat(500) })),
        z.object({ body: z.string() }),
        50,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('rejects malformed JSON and forged privileged fields', async () => {
    await expect(readJson(request('{'), authSchema)).rejects.toMatchObject({ status: 400 });
    await expect(
      readJson(
        request(JSON.stringify({ action: 'takeover', businessId, conversationId, role: 'owner' })),
        workspaceMutationSchema,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('blocks unsafe redirects, encoded protocol tricks, and non-allowlisted destinations', () => {
    for (const target of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%5c%5cevil.example',
      '/api/admin',
      '/app\r\nLocation:evil',
      'javascript:alert(1)',
    ])
      expect(safeRedirectPath(target)).toBe('/app');
    expect(safeRedirectPath('/app/leads?page=2')).toBe('/app/leads?page=2');
  });
  it('renders only generic errors and request IDs, not SDK details', async () => {
    const secret = ['private', 'provider', 'credential'].join('-');
    const response = errorResponse(new Error(`Upstream rejected Authorization: ${secret}`));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain(secret);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});

describe('verified identity and authorization', () => {
  it('rejects missing and expired provider sessions before database access', async () => {
    await expect(requireMembership(businessId)).rejects.toMatchObject({ status: 401 });
    expect(state.calls).toEqual(['verify-user']);
  });
  it('requires verified email and rejects browser metadata roles', async () => {
    state.user = { ...verified, email_confirmed_at: null };
    await expect(requireUser()).rejects.toMatchObject({ code: 'email_verification_required' });
    state.user = verified;
    await expect(requireMembership(businessId, 'billing')).rejects.toMatchObject({ status: 403 });
    expect(roleCan('admin', 'billing')).toBe(false);
    expect(roleCan('__proto__', 'read')).toBe(false);
  });
  it('rejects revoked sessions even while a provider JWT is not yet expired', async () => {
    state.user = verified;
    state.active = false;
    await expect(requireUser()).rejects.toMatchObject({ status: 401, code: 'session_revoked' });
  });
  it('denies a member of another tenant and viewer mutations', async () => {
    state.user = verified;
    await expect(requireMembership(businessId)).rejects.toMatchObject({ status: 403 });
    state.membership = { role: 'viewer', business_id: businessId };
    state.business = { id: businessId, name: 'Synthetic Roofing', suspended_at: null };
    await expect(requireMembership(businessId, 'conversation')).rejects.toMatchObject({
      status: 403,
    });
    expect((await requireMembership(businessId)).role).toBe('viewer');
  });
  it('rejects suspended businesses even when a membership is present', async () => {
    state.user = verified;
    state.membership = { role: 'owner', business_id: businessId };
    state.business = { id: businessId, suspended_at: new Date().toISOString() };
    await expect(requireMembership(businessId)).rejects.toMatchObject({ status: 403 });
  });
  it('enforces enrolled MFA for workspace and independently for admin', async () => {
    state.user = verified;
    state.nextLevel = 'aal2';
    await expect(requireUser()).rejects.toMatchObject({ code: 'mfa_required' });
    state.nextLevel = 'aal1';
    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 403 });
    state.currentLevel = 'aal2';
    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 403 });
    state.admin = true;
    await expect(requirePlatformAdmin()).resolves.toHaveProperty('user.id', verified.id);
  });
  it('enforces the role matrix and recent signin for sensitive changes', () => {
    expect(roleCan('staff', 'conversation')).toBe(true);
    expect(roleCan('staff', 'billing')).toBe(false);
    expect(roleCan('owner', 'integration')).toBe(true);
    expect(() =>
      requireRecentSignIn({ ...verified, last_sign_in_at: '2000-01-01T00:00:00Z' } as never),
    ).toThrow(HttpError);
  });
  it('enforces shared-store rate limits with retry information', async () => {
    await expect(enforceRateLimit('test', 'synthetic', 1, 60)).resolves.toBeUndefined();
    state.rateAllowed = false;
    await expect(enforceRateLimit('test', 'synthetic', 1, 60)).rejects.toMatchObject({
      status: 429,
      retryAfter: 25,
    });
  });
});

describe('production configuration', () => {
  it('fails closed for demo mode, HTTP origins, and missing secrets without printing values', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', 'true');
    let message = '';
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DEMO_MODE');
    expect(message).toContain('APP_ORIGIN');
    expect(message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(message).not.toContain('http://localhost');
  });
});

describe('Route Handler authorization regressions', () => {
  const request = (payload: unknown, origin = 'http://localhost:3000') =>
    new Request('http://localhost:3000/api/workspace', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  it('returns 401 through the HTTP path for an invalid session', async () => {
    const response = await mutateWorkspace(
      request({ action: 'takeover', businessId, conversationId }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
  });
  it('rejects CSRF through the HTTP path before touching identity or data', async () => {
    const response = await mutateWorkspace(
      request({ action: 'takeover', businessId, conversationId }, 'https://cross-origin.example'),
    );
    expect(response.status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it('denies viewer sends and staff membership changes through HTTP', async () => {
    state.user = verified;
    state.business = { id: businessId, name: 'Synthetic', suspended_at: null };
    state.membership = { business_id: businessId, role: 'viewer' };
    expect(
      (
        await mutateWorkspace(
          request({ action: 'send', businessId, conversationId, body: 'Synthetic reply' }),
        )
      ).status,
    ).toBe(403);
    state.membership = { business_id: businessId, role: 'staff' };
    expect(
      (
        await mutateWorkspace(
          request({ action: 'invite', businessId, email: 'teammate@example.test', role: 'viewer' }),
        )
      ).status,
    ).toBe(403);
  });
  it('protects the admin API even for an authenticated tenant owner', async () => {
    state.user = verified;
    state.membership = { business_id: businessId, role: 'owner' };
    const payload = { action: 'pause', businessId, reason: 'Synthetic regression check' };
    expect((await mutateAdmin(request(payload))).status).toBe(403);
    state.currentLevel = 'aal2';
    expect((await mutateAdmin(request(payload))).status).toBe(403);
  });
  it('rejects browser-supplied privileged state in the HTTP schema', async () => {
    const response = await mutateWorkspace(
      request({
        action: 'create-business',
        name: 'Synthetic',
        timezone: 'America/Chicago',
        zipCodes: ['75201'],
        trial_active: true,
        verified_at: new Date().toISOString(),
      }),
    );
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it('preserves generic signup responses without pretending weak passwords were accepted', async () => {
    const payload = {
      action: 'signup',
      name: 'Synthetic',
      email: 'synthetic@example.test',
      password: 'Synthetic1234',
      termsAccepted: true,
    };
    state.authError = { status: 422, code: 'email_exists' };
    const existing = await mutateAuth(request(payload));
    expect(existing.status).toBe(200);
    expect(await existing.json()).toMatchObject({
      message: 'If this email can receive a link, check your inbox for the next step.',
    });
    state.authError = { status: 422, code: 'weak_password' };
    expect((await mutateAuth(request(payload))).status).toBe(400);
    state.authError = { status: 403, code: 'email_provider_disabled' };
    expect((await mutateAuth(request(payload))).status).toBe(503);
  });
  it('verifies a new unverified authenticator owned by the user, while rejecting foreign factors', async () => {
    state.user = verified;
    state.mfaFactors = [{ id: conversationId, factor_type: 'totp', status: 'unverified' }];
    const response = await mutateAuth(
      request({ action: 'mfa', factorId: conversationId, code: '123456' }),
    );
    expect(response.status).toBe(200);
    expect(state.calls).toContain(`mfa:${conversationId}`);
    const foreign = await mutateAuth(
      request({ action: 'mfa', factorId: businessId, code: '123456' }),
    );
    expect(foreign.status).toBe(400);
    expect(state.calls).not.toContain(`mfa:${businessId}`);
  });
});
