export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build')
    return;
  const { getServerEnv } = await import('./lib/server/env');
  const { planSettings } = await import('./lib/server/providers/plan');
  // The production process must fail before accepting traffic with missing auth configuration.
  getServerEnv();
  planSettings();
}
