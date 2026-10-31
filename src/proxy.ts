import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { randomBytes } from 'node:crypto';

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString('base64');
  const production = process.env.NODE_ENV === 'production';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  let response = NextResponse.next({ request: { headers } });
  if (
    /^\/(app|admin)(\/|$)/.test(request.nextUrl.pathname) &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookieOptions: { httpOnly: true, secure: production, sameSite: 'lax', path: '/' },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (updates) => {
            for (const { name, value } of updates) request.cookies.set(name, value);
            response = NextResponse.next({ request: { headers } });
            for (const { name, value, options } of updates)
              response.cookies.set(name, value, options);
          },
        },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000) }),
        },
      },
    );
    try {
      await supabase.auth.getUser();
    } catch {
      /* Every protected page and API verifies access independently. */
    }
  }
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Request-ID', crypto.randomUUID());
  if (production) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
