import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
afterEach(() => vi.unstubAllEnvs());
describe('production browser policy', () => {
  it('enforces unique nonces and prohibits eval in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const a = await proxy(new NextRequest('https://leadrescue.test/'));
    const b = await proxy(new NextRequest('https://leadrescue.test/'));
    const policy = a.headers.get('content-security-policy')!;
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy.match(/nonce-([^']+)/)?.[1]).not.toBe(
      b.headers.get('content-security-policy')?.match(/nonce-([^']+)/)?.[1],
    );
    expect(a.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(a.headers.get('cache-control')).toContain('no-store');
  });
});
