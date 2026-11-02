import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.argv.length !== 3 || process.argv[2] !== '--confirm-isolated-local') {
  console.error(
    'Explicit --confirm-isolated-local is required. This harness is only for local synthetic rendering measurements.',
  );
  process.exit(1);
}
// Next loads dotenv files itself. Refuse the harness if any actual runtime env
// file exists, rather than accidentally loading credentials or production data.
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local'];
if (
  envFiles.some(
    (file) => existsSync(resolve(file)) || existsSync(resolve('.next/standalone', file)),
  )
) {
  console.error(
    'A runtime dotenv file exists. Use a clean isolated checkout with no credentials; no server was started.',
  );
  process.exit(1);
}
if (!existsSync(resolve('.next/BUILD_ID')) || !existsSync(resolve('.next/standalone/server.js'))) {
  console.error('Run npm run build first. No server was started.');
  process.exit(1);
}
const env = {};
for (const key of [
  'PATH',
  'Path',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  HOSTNAME: '127.0.0.1',
  PORT: '3100',
  DEPLOYMENT_ENV: 'staging',
  LOAD_TESTING_ENABLED: 'true',
  APP_ORIGIN: 'https://staging.loadtest.invalid',
  DEMO_MODE: 'false',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.loadtest.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'loadtest-only-inert-public',
  SUPABASE_SERVICE_ROLE_KEY: 'loadtest-only-inert-service',
  AUTH_COOKIE_SECRET: randomBytes(32).toString('base64url'),
  TRUST_PROXY: 'false',
  TWILIO_ENABLED: 'false',
  AI_ENABLED: 'false',
  BILLING_ENABLED: 'false',
  CALENDAR_ENABLED: 'false',
  NOTIFICATIONS_ENABLED: 'false',
  OPERATOR_MAINTENANCE_ENABLED: 'false',
});
console.log(
  'Starting isolated compiled-SSR fixture on loopback port 3100. No real auth, database, worker, or provider is connected.',
);
cpSync(resolve('.next/static'), resolve('.next/standalone/.next/static'), { recursive: true });
if (existsSync(resolve('public')))
  cpSync(resolve('public'), resolve('.next/standalone/public'), { recursive: true });
const child = spawn(process.execPath, ['.next/standalone/server.js'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: false,
});
child.on('error', () => {
  console.error('The isolated local rendering fixture could not start.');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
