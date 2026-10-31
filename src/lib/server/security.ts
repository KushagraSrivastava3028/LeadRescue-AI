import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ConfigurationError, getServerEnv } from './env';
import { createServiceClient } from './supabase';
import { CapabilityUnavailable } from './providers/config';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: Request, expectedOrigin = getServerEnv().APP_ORIGIN) {
  const origin = request.headers.get('origin');
  if (
    !origin ||
    origin !== new URL(expectedOrigin).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new HttpError(403, 'origin_rejected', 'This request could not be accepted.');
  }
}

/** All browser mutations use JSON + exact-origin checks, including anonymous authentication. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = 16_384,
): Promise<z.infer<T>> {
  assertSameOrigin(request);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new HttpError(415, 'invalid_content_type', 'Send a JSON request.');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes)
    throw new HttpError(413, 'body_too_large', 'The request is too large.');
  if (!request.body)
    throw new HttpError(400, 'invalid_request', 'Check the information and try again.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large', 'The request is too large.');
      }
      chunks.push(chunk.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = schema.safeParse(data);
    if (!result.success)
      throw new HttpError(400, 'invalid_request', 'Check the information and try again.');
    return result.data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_request', 'Check the information and try again.');
  } finally {
    reader.releaseLock();
  }
}

export function safeRedirectPath(input: string | null | undefined, fallback = '/app') {
  if (!input || !input.startsWith('/') || input.startsWith('//') || /[\\\r\n\u0000]/.test(input))
    return fallback;
  const url = new URL(input, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid') return fallback;
  const allowed = ['/app', '/onboarding', '/reset-password', '/two-factor'];
  return allowed.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))
    ? `${url.pathname}${url.search}`
    : fallback;
}

export function jsonResponse(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Vary', 'Cookie, Origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, { status, headers });
}

export function redirectResponse(url: string, status = 303) {
  const response = new Response(null, {
    status,
    headers: {
      Location: url,
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  return response;
}

export function errorResponse(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof HttpError) {
    return jsonResponse(
      { ok: false, error: error.message, code: error.code, requestId },
      error.status,
      error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined,
    );
  }
  // Do not serialize SDK errors: they may include upstream URLs, request payloads, or credentials.
  const unavailable = error instanceof ConfigurationError || error instanceof CapabilityUnavailable;
  return jsonResponse(
    {
      ok: false,
      error: unavailable
        ? 'This service is not configured yet. Contact your workspace owner.'
        : 'The request could not be completed. Please try again.',
      code: unavailable ? 'service_unavailable' : 'request_failed',
      requestId,
    },
    unavailable ? 503 : 500,
  );
}

export function checkDatabaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'PT429')
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.', 60);
  if (['42501', 'PGRST301', 'PGRST302'].includes(error.code ?? ''))
    throw new HttpError(403, 'forbidden', 'You do not have permission to perform this action.');
  if (['23503', '23514', 'P0001', '23505', '22P02', '22023'].includes(error.code ?? ''))
    throw new HttpError(
      409,
      'operation_rejected',
      'This operation could not be completed. Refresh and check its prerequisites.',
    );
  if (error.code === '55P03')
    throw new HttpError(
      409,
      'dispatch_in_progress',
      'A message is being dispatched. Wait a moment and try again.',
      2,
    );
  throw new HttpError(503, 'database_unavailable', 'Your workspace is temporarily unavailable.');
}

export function clientRateIdentity(request: Request) {
  const env = getServerEnv();
  const value =
    env.TRUST_PROXY && env.TRUSTED_CLIENT_IP_HEADER
      ? request.headers.get(env.TRUSTED_CLIENT_IP_HEADER)
      : null;
  // The deployment gateway must strip client-provided copies of this configured header.
  return value && isIP(value) ? value : 'untrusted-source';
}

export async function enforceRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
) {
  const key = `${scope}:${createHash('sha256').update(identity).digest('hex')}`;
  const { data, error } = await createServiceClient().rpc('consume_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  checkDatabaseError(error);
  if (!data || typeof data.allowed !== 'boolean')
    throw new HttpError(503, 'rate_limit_unavailable', 'This service is temporarily unavailable.');
  if (!data.allowed)
    throw new HttpError(
      429,
      'rate_limited',
      'Too many requests. Please wait and try again.',
      Math.max(1, Number(data.retry_after) || windowSeconds),
    );
}
