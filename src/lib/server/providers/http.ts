import 'server-only';

const allowedHosts = new Set([
  'api.openai.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'openidconnect.googleapis.com',
  'api.resend.com',
]);
/** Only fixed provider hosts; redirects are rejected instead of following arbitrary destinations. */
export async function providerFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    (parsed.port && parsed.port !== '443') ||
    !allowedHosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Provider destination rejected');
  return fetch(parsed, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
}
export async function boundedJson(response: Response, maxBytes = 256_000): Promise<unknown> {
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider response missing');
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Provider response too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
