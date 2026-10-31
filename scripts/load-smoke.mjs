import { performance } from 'node:perf_hooks';
const origin = 'http://127.0.0.1:3000';
const timings = [];
let next = 0;
let failures = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < 100) {
      const id = next++;
      const start = performance.now();
      try {
        const response = await fetch(`${origin}${id % 2 ? '/demo' : '/api/health'}`, {
          signal: AbortSignal.timeout(15000),
        });
        await response.arrayBuffer();
        if (!response.ok) failures++;
      } catch {
        failures++;
      }
      timings.push(performance.now() - start);
    }
  }),
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    scope: 'local development HTTP smoke; no provider or database load',
    requests: 100,
    concurrency: 5,
    failures,
    elapsedMs: Math.round(performance.now() - started),
    p50Ms: Math.round(timings[49]),
    p95Ms: Math.round(timings[94]),
  }),
);
process.exitCode = failures ? 1 : 0;
