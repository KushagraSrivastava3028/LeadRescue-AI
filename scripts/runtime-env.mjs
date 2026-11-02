import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export function validateEnvironment({
  production = process.env.NODE_ENV === 'production',
  worker = false,
} = {}) {
  const invalid = new Set();
  const read = (name) => process.env[name]?.trim() || '';
  const requireValue = (name) => {
    const value = read(name);
    if (!value || /placeholder|replace[-_ ]?me|your[-_]|example\.com/i.test(value))
      invalid.add(name);
    return value;
  };
  const url = (name, protocols, required = true) => {
    const value = required ? requireValue(name) : read(name);
    if (!value) return null;
    try {
      const result = new URL(value);
      if (!protocols.includes(result.protocol)) invalid.add(name);
      return result;
    } catch {
      invalid.add(name);
      return null;
    }
  };
  const flags = [
    'DEMO_MODE',
    'TRUST_PROXY',
    'TWILIO_ENABLED',
    'AI_ENABLED',
    'BILLING_ENABLED',
    'BILLING_LIVE_APPROVED',
    'CALENDAR_ENABLED',
    'NOTIFICATIONS_ENABLED',
    'OPERATOR_MAINTENANCE_ENABLED',
  ];
  for (const name of flags)
    if (read(name) && !['true', 'false'].includes(read(name))) invalid.add(name);
  const enabled = (name) => read(`${name}_ENABLED`) === 'true';
  if (production) {
    const origin = url('APP_ORIGIN', ['https:']);
    if (
      origin &&
      (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(origin.hostname) ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        origin.username ||
        origin.password)
    )
      invalid.add('APP_ORIGIN');
    if (read('DEMO_MODE') === 'true') invalid.add('DEMO_MODE');
    url('NEXT_PUBLIC_SUPABASE_URL', ['https:']);
    requireValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    requireValue('SUPABASE_SERVICE_ROLE_KEY');
    if (requireValue('AUTH_COOKIE_SECRET').length < 32) invalid.add('AUTH_COOKIE_SECRET');
  }
  if (
    read('TRUST_PROXY') === 'true' &&
    !['x-real-ip', 'cf-connecting-ip'].includes(read('TRUSTED_CLIENT_IP_HEADER'))
  )
    invalid.add('TRUSTED_CLIENT_IP_HEADER');
  if (worker || enabled('TWILIO') || enabled('BILLING') || enabled('CALENDAR') || enabled('AI')) {
    const connectionName =
      worker && read('WORKER_DATABASE_URL') ? 'WORKER_DATABASE_URL' : 'DATABASE_URL';
    const connection = url(connectionName, ['postgres:', 'postgresql:']);
    const mode = worker
      ? read('WORKER_DATABASE_CONNECTION_MODE') || read('DATABASE_CONNECTION_MODE')
      : read('DATABASE_CONNECTION_MODE');
    if (worker && (connection?.port === '6543' || mode === 'transaction'))
      invalid.add(connectionName);
  }
  if (
    read('APPLICATION_RUNTIME') &&
    !['persistent', 'serverless'].includes(read('APPLICATION_RUNTIME'))
  )
    invalid.add('APPLICATION_RUNTIME');
  for (const name of ['DATABASE_CONNECTION_MODE', 'WORKER_DATABASE_CONNECTION_MODE'])
    if (read(name) && !['direct', 'session', 'transaction'].includes(read(name))) invalid.add(name);
  for (const [name, ceiling] of [
    ['DB_POOL_MAX', 50],
    ['WORKER_DB_POOL_MAX', 50],
    ['QUEUE_DB_POOL_MAX', 20],
  ])
    if (
      read(name) &&
      (!/^\d+$/.test(read(name)) || Number(read(name)) < 1 || Number(read(name)) > ceiling)
    )
      invalid.add(name);
  const positive = (name) => {
    if (!/^\d+$/.test(requireValue(name)) || Number(read(name)) < 1) invalid.add(name);
  };
  for (const name of ['PLAN_MONTHLY_PRICE_MINOR', 'PLAN_PAID_SMS_LIMIT', 'PLAN_PAID_AI_LIMIT'])
    if (
      read(name) &&
      (!/^\d+$/.test(read(name)) ||
        Number(read(name)) < 1 ||
        Number(read(name)) > (name === 'PLAN_MONTHLY_PRICE_MINOR' ? 1000000 : 100000))
    )
      invalid.add(name);
  if (enabled('TWILIO')) {
    if (!/^AC[a-f0-9]{32}$/i.test(requireValue('TWILIO_ACCOUNT_SID')))
      invalid.add('TWILIO_ACCOUNT_SID');
    requireValue('TWILIO_AUTH_TOKEN');
    url('TWILIO_WEBHOOK_ORIGIN', production ? ['https:'] : ['http:', 'https:']);
    positive('PLATFORM_DAILY_SMS_SEGMENT_LIMIT');
  }
  if (enabled('AI')) {
    requireValue('OPENAI_API_KEY');
    requireValue('OPENAI_MODEL');
    positive('AI_MAX_CALL_COST_MINOR');
    positive('PLATFORM_DAILY_AI_COST_LIMIT_MINOR');
  }
  if (enabled('BILLING')) {
    const key = requireValue('STRIPE_SECRET_KEY');
    requireValue('STRIPE_WEBHOOK_SECRET');
    requireValue('STRIPE_PRICE_ID');
    if (production && !key.startsWith('sk_test_') && read('BILLING_LIVE_APPROVED') !== 'true')
      invalid.add('BILLING_LIVE_APPROVED');
  }
  if (enabled('CALENDAR')) {
    requireValue('GOOGLE_CLIENT_ID');
    requireValue('GOOGLE_CLIENT_SECRET');
    const redirect = url('GOOGLE_REDIRECT_URI', production ? ['https:'] : ['http:', 'https:']);
    if (redirect?.href !== `${read('APP_ORIGIN')}/api/calendar/callback`)
      invalid.add('GOOGLE_REDIRECT_URI');
  }
  if (enabled('TWILIO') || enabled('CALENDAR')) {
    if (Buffer.from(requireValue('TOKEN_ENCRYPTION_KEY'), 'base64').length !== 32)
      invalid.add('TOKEN_ENCRYPTION_KEY');
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(requireValue('TOKEN_ENCRYPTION_KEY_VERSION')))
      invalid.add('TOKEN_ENCRYPTION_KEY_VERSION');
  }
  if (invalid.size)
    throw new Error(`Missing or invalid configuration: ${[...invalid].sort().join(', ')}`);
  return {
    production,
    worker,
    enabledCapabilities: ['TWILIO', 'AI', 'BILLING', 'CALENDAR'].filter(enabled),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validateEnvironment({
      production: process.argv.includes('--production') || process.env.NODE_ENV === 'production',
      worker: process.argv.includes('--worker'),
    });
    console.log(JSON.stringify({ status: 'valid', ...result }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
