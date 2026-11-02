import 'server-only';
/** An admission marker for the read-only test runner, never an authentication bypass. */
export function loadTestEnvironment() {
  if (process.env.LOAD_TESTING_ENABLED !== 'true') return null;
  const environment =
    process.env.DEPLOYMENT_ENV === 'staging'
      ? 'staging'
      : process.env.NODE_ENV === 'development'
        ? 'development'
        : null;
  if (!environment) return null;
  for (const name of [
    'TWILIO_ENABLED',
    'AI_ENABLED',
    'BILLING_ENABLED',
    'CALENDAR_ENABLED',
    'NOTIFICATIONS_ENABLED',
  ]) {
    const value = process.env[name];
    if (value !== undefined && value !== '' && value !== 'false') return null;
  }
  return {
    environment,
    paidIntegrationsDisabled: true as const,
    loadTestingEnabled: true as const,
  };
}
