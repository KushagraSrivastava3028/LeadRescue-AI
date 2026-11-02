import { expect, test } from '@playwright/test';

test('public and signed-in-looking requests never share nonce HTML or private API responses', async ({
  request,
}) => {
  const responses = await Promise.all([
    request.get('/', { headers: { Cookie: 'synthetic-browser=a' } }),
    request.get('/', { headers: { Cookie: 'synthetic-browser=b' } }),
  ]);
  const nonces: string[] = [];
  for (const response of responses) {
    expect(response.status()).toBe(200);
    const headers = response.headers();
    if (process.env.PLAYWRIGHT_EXPECT_PRODUCTION === 'true')
      expect(headers['cache-control']).toContain('private');
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['cache-control']).not.toContain('public');
    expect(headers['cache-control']).not.toContain('s-maxage');
    expect(headers['set-cookie']).toBeUndefined();
    const nonce = headers['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    nonces.push(nonce!);
    const html = await response.text();
    for (const script of html.match(/<script\b[^>]*>/g) || [])
      expect(script).toContain(`nonce="${nonce}"`);
  }
  expect(nonces[0]).not.toBe(nonces[1]);
  for (const path of ['/api/auth', '/api/workspace', '/api/admin']) {
    const response = await request.get(path);
    expect([401, 403, 503]).toContain(response.status());
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

test('Next owns content-hashed static asset caching and deployment invalidates the URL', async ({
  request,
}) => {
  const response = await request.get('/');
  const html = await response.text();
  const asset = html.match(
    /(?:src|href)="([^"?]*\/_next\/static\/[^"?]+\.(?:js|css))(?:\?[^"<]*)?"/,
  )?.[1];
  expect(asset).toBeTruthy();
  const assetResponse = await request.get(asset!);
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()['set-cookie']).toBeUndefined();
  const cache = assetResponse.headers()['cache-control'];
  if (process.env.PLAYWRIGHT_EXPECT_PRODUCTION === 'true') {
    expect(cache).toContain('public');
    expect(cache).toContain('max-age=31536000');
    expect(cache).toContain('immutable');
  } else {
    // Next disables immutable caching in development so edits are observable.
    // Do not pretend a dev response verifies production CDN configuration.
    expect(cache).toMatch(/no-store|no-cache|max-age=0/);
  }
});
