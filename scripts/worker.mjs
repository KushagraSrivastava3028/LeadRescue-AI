import { validateEnvironment } from './runtime-env.mjs';
try {
  process.env.LEADRESCUE_PROCESS_KIND = 'worker';
  validateEnvironment({ worker: true });
  await import('../src/worker/index.ts');
} catch (error) {
  // Zod/provider errors can contain their input. Never serialize them or their stacks.
  if (error instanceof Error && error.message.startsWith('Missing or invalid configuration:'))
    console.error(error.message);
  else
    console.error(
      'Worker startup failed. Review the configured variable names and operator health logs.',
    );
  process.exitCode = 1;
}
