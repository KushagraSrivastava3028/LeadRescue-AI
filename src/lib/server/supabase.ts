import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ConfigurationError, requireSupabaseConfiguration } from './env';

export async function createUserClient() {
  const { env, url, key } = requireSupabaseConfiguration();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (updates) => {
        // Route Handlers refresh these cookies. Read-only Server Components cannot write them.
        try {
          for (const { name, value, options } of updates) cookieStore.set(name, value, options);
        } catch {
          // A separate authenticated API request performs refresh; authorization still calls getUser.
        }
      },
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
          signal: init?.signal ?? AbortSignal.timeout(10_000),
        }),
    },
  });
}

/** Privileged access is limited to internal rate limits/admin records. Always scope tenant queries. */
export function createServiceClient() {
  const { env, url } = requireSupabaseConfiguration();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new ConfigurationError(['SUPABASE_SERVICE_ROLE_KEY']);
  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
          signal: init?.signal ?? AbortSignal.timeout(10_000),
        }),
    },
  });
}
