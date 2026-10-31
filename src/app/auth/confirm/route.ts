import { cookies } from 'next/headers';
import { createUserClient } from '@/lib/server/supabase';
import { getServerEnv } from '@/lib/server/env';
import { signCookie } from '@/lib/server/signed-cookie';
import { redirectResponse } from '@/lib/server/security';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (
    tokenHash &&
    tokenHash.length < 4096 &&
    (type === 'signup' || type === 'recovery' || type === 'email' || type === 'invite')
  ) {
    try {
      const client = await createUserClient();
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error && data.user) {
        if (type === 'recovery') {
          const name = env.NODE_ENV === 'production' ? '__Host-lr-recovery' : 'lr-recovery';
          (await cookies()).set(
            name,
            await signCookie({ sub: data.user.id }, 'password-recovery'),
            {
              httpOnly: true,
              secure: env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: 600,
            },
          );
          return redirectResponse(`${env.APP_ORIGIN}/reset-password`);
        }
        return redirectResponse(`${env.APP_ORIGIN}/onboarding`);
      }
    } catch {
      /* Generic link failure below; no token logging. */
    }
  }
  return redirectResponse(`${env.APP_ORIGIN}/signin?error=link_invalid`);
}
