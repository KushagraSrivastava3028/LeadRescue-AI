import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProfile, summaryLabel, validateTarget } from '../load-tests/safety.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--profile', '--base-url', '--staging-allowlist', '--label']);
const input = {};
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || !args[i + 1] || input[args[i]] !== undefined)
    throw new Error(
      'Use --profile, --base-url, --staging-allowlist, and --label with explicit values.',
    );
  input[args[i]] = args[i + 1];
}
const target = validateTarget(input['--base-url'], input['--staging-allowlist']);
const profile = input['--profile'] || 'full';
loadProfile(profile);
const label = summaryLabel(input['--label'] || 'latest');
mkdirSync(resolve('.cache/load-tests'), { recursive: true });
const local = resolve('.cache/k6', process.platform === 'win32' ? 'k6.exe' : 'k6');
const executable = existsSync(local) ? local : 'k6';
// Do not inherit K6_OUT, cloud tokens, debug HTTP switches, or provider credentials.
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
  K6_NO_USAGE_REPORT: 'true',
  BASE_URL: target.origin,
  ALLOWED_STAGING_ORIGIN: input['--staging-allowlist'] || '',
  PROFILE: profile,
  SUMMARY_LABEL: label,
});
const child = spawn(
  executable,
  [
    'run',
    '--quiet',
    '--config',
    'load-tests/k6.config.json',
    '--no-usage-report',
    'load-tests/journey.js',
  ],
  {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false,
  },
);
child.on('error', () => {
  console.error(
    'k6 is unavailable. Run scripts/loadtest-install-k6.ps1 on Windows or install the official k6 package.',
  );
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
