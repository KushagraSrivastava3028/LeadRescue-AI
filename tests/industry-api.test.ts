import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'owner',
  rpc: vi.fn(),
  updates: vi.fn(),
  target: vi.fn(),
}));
const businessId = '10000000-0000-4000-8000-000000000010';
vi.mock('@/lib/server/supabase', () => ({
  createUserClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: '10000000-0000-4000-8000-000000000001', email_confirmed_at: '2026-01-01' },
        },
        error: null,
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: 'aal1', nextLevel: 'aal1' },
          error: null,
        }),
      },
    },
    rpc: async (name: string, args: unknown) => {
      state.rpc(name, args);
      return { data: name === 'check_active_session' ? true : businessId, error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => ({
          data:
            table === 'memberships'
              ? { role: state.role, business_id: businessId }
              : { id: businessId, name: 'Acme', suspended_at: null },
          error: null,
        }),
        update: (value: unknown) => {
          state.updates(value);
          return {
            eq: async (column: string, id: string) => {
              state.target(column, id);
              return { error: null };
            },
          };
        },
      };
      return query;
    },
  }),
  createServiceClient: () => ({
    rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }),
  }),
}));
import { POST } from '@/app/api/workspace/route';
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'owner';
  vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
});
afterEach(() => vi.unstubAllEnvs());
function request(data: unknown) {
  return new Request('http://127.0.0.1:3000/api/workspace', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
const settings = {
  action: 'settings',
  businessId,
  name: 'Acme Appliances',
  industry: 'custom',
  services: ['Washer repair'],
  intakeQuestions: ['Which appliance needs attention?'],
  appointmentLabel: 'Diagnostic visit',
  zipCodes: ['75201'],
  timezone: 'America/Chicago',
  escalationPhone: null,
  assistantRestrictions: [],
  faqs: [],
  openingHours: { mon: { open: '08:00', close: '18:00' } },
};
describe('industry HTTP boundaries', () => {
  it('passes a validated selected industry into atomic onboarding', async () => {
    expect(
      (
        await POST(
          request({
            action: 'create-business',
            name: 'Acme Plumbing',
            industry: 'plumbing',
            timezone: 'America/Chicago',
            zipCodes: ['75201'],
          }),
        )
      ).status,
    ).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('create_business_for_industry', {
      p_name: 'Acme Plumbing',
      p_industry: 'plumbing',
      p_timezone: 'America/Chicago',
      p_zip_codes: ['75201'],
    });
  });
  it('persists owner industry settings with the authenticated business filter', async () => {
    expect((await POST(request(settings))).status).toBe(200);
    expect(state.updates).toHaveBeenCalledWith(
      expect.objectContaining({
        industry: 'custom',
        services: ['Washer repair'],
        intake_questions: ['Which appliance needs attention?'],
        appointment_label: 'Diagnostic visit',
      }),
    );
    expect(state.target).toHaveBeenCalledWith('business_id', businessId);
  });
  it('rejects staff profile mutations and invalid/privileged configuration', async () => {
    state.role = 'staff';
    expect((await POST(request(settings))).status).toBe(403);
    expect(state.updates).not.toHaveBeenCalled();
    state.role = 'owner';
    for (const extra of [
      { industry: 'unknown' },
      { intakeQuestions: ['one', 'two', 'three', 'four'] },
      { automation_enabled: true },
    ])
      expect((await POST(request({ ...settings, ...extra }))).status).toBe(400);
    expect(state.updates).not.toHaveBeenCalled();
  });
});
