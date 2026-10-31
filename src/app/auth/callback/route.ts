import { createUserClient } from '@/lib/server/supabase';
import { getServerEnv } from '@/lib/server/env';
import { redirectResponse, safeRedirectPath } from '@/lib/server/security';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeRedirectPath(url.searchParams.get('next'), '/onboarding');
  if (code && code.length < 4096) {
    try {
      const client = await createUserClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return redirectResponse(`${env.APP_ORIGIN}${next}`);
    } catch {
      /* Return a generic error; never include codes or provider errors in redirects. */
    }
  }
  return redirectResponse(`${env.APP_ORIGIN}/signin?error=link_invalid`);
}
