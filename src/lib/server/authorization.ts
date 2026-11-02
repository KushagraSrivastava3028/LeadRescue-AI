import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createServiceClient, createUserClient } from './supabase';
import { checkDatabaseError, HttpError } from './security';

export type WorkspaceRole = 'owner' | 'staff' | 'viewer';
export const permissions: Record<WorkspaceRole, readonly string[]> = {
  owner: ['read', 'conversation', 'lead', 'profile', 'billing', 'membership', 'integration'],
  staff: ['read', 'conversation', 'lead'],
  viewer: ['read'],
};
export function roleCan(role: string, permission: string): boolean {
  return (
    Object.hasOwn(permissions, role) && permissions[role as WorkspaceRole].includes(permission)
  );
}

export async function requireUser(): Promise<{ client: SupabaseClient; user: User }> {
  const client = await createUserClient();
  // getUser performs server verification/revocation checks. getSession's decoded object is not authorization.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
  const active = await client.rpc('check_active_session');
  checkDatabaseError(active.error);
  if (!active.data)
    throw new HttpError(401, 'session_revoked', 'Your session has ended. Please sign in again.');
  if (!data.user.email_confirmed_at)
    throw new HttpError(403, 'email_verification_required', 'Verify your email before continuing.');
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw new HttpError(401, 'unauthenticated', 'Please sign in to continue.');
  if (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2')
    throw new HttpError(403, 'mfa_required', 'Complete two-step verification to continue.');
  return { client, user: data.user };
}

type VerifiedIdentity = Awaited<ReturnType<typeof requireUser>>;

async function membershipForVerifiedUser(
  { client, user }: VerifiedIdentity,
  businessId: string,
  permission: string,
) {
  const { data, error } = await client
    .from('memberships')
    .select('role,business_id')
    .eq('business_id', businessId)
    .eq('user_id', user.id)
    .is('suspended_at', null)
    .maybeSingle();
  checkDatabaseError(error);
  if (!data || !roleCan(data.role, permission))
    throw new HttpError(403, 'forbidden', 'You do not have permission to access this workspace.');
  const business = await client
    .from('businesses')
    .select(
      'id,name,timezone,state,suspended_at,verified_at,live_test_passed_at,trial_started_at,trial_ends_at',
    )
    .eq('id', businessId)
    .maybeSingle();
  checkDatabaseError(business.error);
  if (!business.data || business.data.suspended_at)
    throw new HttpError(403, 'workspace_unavailable', 'This workspace is unavailable.');
  return { client, user, role: data.role as WorkspaceRole, business: business.data };
}

export async function requireMembership(businessId: string, permission = 'read') {
  return membershipForVerifiedUser(await requireUser(), businessId, permission);
}

/**
 * A read-only handler may reuse its verified identity snapshot during that one
 * incoming request. Construct this scope inside the handler, never at module
 * scope or around a mutation. No result survives into another request, and
 * membership/business authorization is still read fresh whenever requested.
 */
export function createReadAuthorizationScope() {
  let verified: Promise<VerifiedIdentity> | undefined;
  function readUser(): Promise<VerifiedIdentity> {
    if (!verified) {
      verified = requireUser().catch((error: unknown) => {
        verified = undefined;
        throw error;
      });
    }
    return verified;
  }
  return {
    requireUser: readUser,
    async requireMembership(businessId: string, permission = 'read') {
      return membershipForVerifiedUser(await readUser(), businessId, permission);
    },
  };
}

export async function requirePlatformAdmin() {
  const { client, user } = await requireUser();
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data.currentLevel !== 'aal2')
    throw new HttpError(403, 'forbidden', 'This action requires administrator verification.');
  const admin = await client.rpc('check_platform_admin');
  checkDatabaseError(admin.error);
  if (!admin.data) throw new HttpError(403, 'forbidden', 'This action is unavailable.');
  return { client, user, service: createServiceClient() };
}

export function requireRecentSignIn(user: User, maxAgeSeconds = 900) {
  const signedIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
  if (!signedIn || Date.now() - signedIn > maxAgeSeconds * 1000 || signedIn > Date.now() + 60_000) {
    throw new HttpError(
      403,
      'reauthentication_required',
      'Sign in again before changing sensitive account settings.',
    );
  }
}
