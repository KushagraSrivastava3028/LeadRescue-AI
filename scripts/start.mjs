import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { validateEnvironment } from './runtime-env.mjs';
try {
  validateEnvironment({ production: true });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
process.env.NODE_ENV = 'production';
const standalone = existsSync('server.js');
const args = standalone
  ? ['server.js']
  : ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
