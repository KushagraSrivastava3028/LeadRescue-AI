import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { requireMembership, requireRecentSignIn } from '@/lib/server/authorization';
import { getServerEnv } from '@/lib/server/env';
import {
  checkDatabaseError,
  enforceRateLimit,
  HttpError,
  redirectResponse,
} from '@/lib/server/security';
import { verifyCookie } from '@/lib/server/signed-cookie';
import { createServiceClient } from '@/lib/server/supabase';
import { exchangeCalendarCode } from '@/lib/server/providers/calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const grantSchema = z.object({
  sub: uuidSchema,
  businessId: uuidSchema,
  state: z.string().regex(/^[a-f0-9]{64}$/),
  verifier: z.string().min(43).max(128),
});

/** OAuth callback is the protocol's one-time GET exchange; normal application mutations remain POST-only. */
export async function GET(request: Request) {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const name = env.NODE_ENV === 'production' ? '__Host-lr-calendar' : 'lr-calendar';
  const token = cookieStore.get(name)?.value;
  // Consume the browser state before exchanging the provider code, including on failure.
  cookieStore.delete(name);
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get('state');
    const code = params.get('code');
    if (
      !token ||
      !state ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !code ||
      code.length > 4096 ||
      params.has('error')
    )
      throw new HttpError(400, 'oauth_rejected', 'Calendar connection could not be verified.');
    const grant = grantSchema.parse(await verifyCookie(token, 'calendar-oauth'));
    if (!timingSafeEqual(Buffer.from(grant.state), Buffer.from(state)))
      throw new HttpError(400, 'oauth_rejected', 'Calendar connection could not be verified.');
    const { user } = await requireMembership(grant.businessId, 'integration');
    requireRecentSignIn(user);
    if (user.id !== grant.sub)
      throw new HttpError(403, 'oauth_rejected', 'Calendar connection could not be verified.');
    await enforceRateLimit('calendar:connect', `${grant.businessId}:${user.id}`, 5, 3600);
    const tokens = await exchangeCalendarCode(code, grant.verifier, grant.businessId);
    const service = createServiceClient();
    const { error } = await service
      .from('calendar_connections')
      .upsert(
        {
          business_id: grant.businessId,
          provider: 'google',
          calendar_id: 'primary',
          refresh_token_ciphertext: tokens.refreshTokenCiphertext,
          key_version: tokens.keyVersion,
          scopes: tokens.scopes,
          revoked_at: null,
        },
        { onConflict: 'business_id,provider' },
      );
    checkDatabaseError(error);
    const audit = await service
      .from('audit_logs')
      .insert({
        business_id: grant.businessId,
        actor_user_id: user.id,
        action: 'calendar.connected',
        resource_id: grant.businessId,
        metadata: { provider: 'google' },
      });
    checkDatabaseError(audit.error);
    return redirectResponse(`${env.APP_ORIGIN}/app/calendar?connection=ready`);
  } catch {
    // Codes, state, tokens, and upstream provider errors never enter the redirect.
    return redirectResponse(`${env.APP_ORIGIN}/app/calendar?connection=failed`);
  }
}
