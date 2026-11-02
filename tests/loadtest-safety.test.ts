import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STEPS,
  loadProfile,
  phaseAt,
  summaryLabel,
  validateEnvironmentGuard,
  validateTarget,
} from '../load-tests/safety.mjs';

describe('load-test target and paid-side-effect boundaries', () => {
  it('accepts only exact loopback origins without extra URL components', () => {
    for (const origin of ['http://127.0.0.1:3000', 'http://localhost:3100', 'http://[::1]:3000'])
      expect(validateTarget(origin).kind).toBe('local');
    for (const origin of [
      'http://127.0.0.2:3000',
      'http://localhost.evil.test',
      'http://127.0.0.1:70000',
      'http://user:pass@localhost',
      'http://127.0.0.1:3000/path',
      'http://127.0.0.1:3000?production=true',
      'http://169.254.169.254',
    ])
      expect(() => validateTarget(origin)).toThrow();
  });
  it('requires both a visibly staging hostname and an exact explicit allowlist', () => {
    expect(
      validateTarget(
        'https://leadrescue-staging.onrender.com',
        'https://leadrescue-staging.onrender.com',
      ).kind,
    ).toBe('staging');
    for (const origin of [
      'https://leadrescue.com',
      'https://www.leadrescue.in',
      'https://stagingish.example.test',
    ])
      expect(() => validateTarget(origin, origin)).toThrow();
    expect(() =>
      validateTarget('https://staging.example.test', 'https://staging.other.test'),
    ).toThrow();
    expect(() => validateTarget('https://staging.example.test')).toThrow();
  });
  it('refuses production, missing guards, and any failure to prove integrations are disabled', () => {
    const valid = {
      environment: 'development',
      paidIntegrationsDisabled: true,
      loadTestingEnabled: true,
    };
    expect(validateEnvironmentGuard(valid, 'local')).toBe(true);
    expect(validateEnvironmentGuard({ ...valid, environment: 'staging' }, 'staging')).toBe(true);
    for (const payload of [
      null,
      {},
      { ...valid, paidIntegrationsDisabled: false },
      { ...valid, loadTestingEnabled: false },
      { ...valid, environment: 'production' },
    ])
      expect(() => validateEnvironmentGuard(payload, 'local')).toThrow();
    expect(() => validateEnvironmentGuard(valid, 'staging')).toThrow();
  });
  it('keeps the chosen journey to public/demo reads without login, writes, or provider APIs', () => {
    expect(JOURNEY_STEPS).toHaveLength(5);
    expect(JOURNEY_STEPS.map((s) => s.path)).toEqual([
      '/',
      '/pricing',
      '/demo',
      '/demo/leads',
      '/demo/inbox',
    ]);
    expect(
      JOURNEY_STEPS.every((s) => !s.path.startsWith('/api/') && !s.path.startsWith('/app')),
    ).toBe(true);
  });
  it('bounds the full ramp at 100 users and holds each requested level for 2 minutes', () => {
    const stages = loadProfile('full');
    expect(Math.max(...stages.map((s) => s.target))).toBe(100);
    expect(
      stages.filter((s) => s.name.startsWith('hold_')).map((s) => [s.target, s.seconds]),
    ).toEqual([
      [20, 120],
      [50, 120],
      [100, 120],
    ]);
    expect(stages.reduce((sum, s) => sum + s.seconds, 0)).toBe(480);
    expect(() => loadProfile('unbounded')).toThrow();
    expect(phaseAt(stages, 30_000)).toBe('hold_20');
    expect(phaseAt(stages, 330_000)).toBe('hold_100');
  });
  it('rejects report path traversal', () => {
    expect(summaryLabel('after-full')).toBe('after-full');
    for (const value of ['../secret', 'C:\\export', 'report.json', '/tmp/report', ''])
      expect(() => summaryLabel(value)).toThrow();
  });
});
