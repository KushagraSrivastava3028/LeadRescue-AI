# Safe local and staging load tests

The k6 journey measures five read-only steps: opening the product page, checking
pricing, opening the synthetic overview, viewing the synthetic lead list, and
opening the synthetic inbox. Each step waits 0.6–1.2 seconds before the next.
These are genuine Next.js HTTP routes, but the demo records are synthetic and
browser-local. No authenticated Supabase query, queue task, payment, email, SMS,
AI request, or calendar write is exercised. Do not interpret these results as
database capacity, provider throughput, hosted-plan capacity, or a complete
customer-session benchmark.

No Redis, managed load-testing service, Kubernetes, or new infrastructure is
required. k6 runs locally with telemetry disabled. No paid third-party API is
called by the script.

## Before and after safety evidence

Before changing the load-test tooling, the existing endpoint/security-policy
tests passed: `npm test -- tests/security-boundaries.test.ts tests/proxy.test.ts`
reported **23 passing tests**. The new target/guard/journey/report-path regressions
passed: `npm test -- tests/loadtest-safety.test.ts` reported **6 passing tests**.
The installed k6 script was parsed with `k6 inspect --execution-requirements`
without issuing HTTP requests; it confirmed a maximum of 100 virtual users and
an 8-minute staged ramp plus a short graceful stop. Final root verification
records any subsequent changed-test totals.

## Install k6

The local Windows installation uses **Grafana k6 v2.3.0**. The helper downloads
the official release archive, checks its SHA-256 against the official checksum
file, and extracts only under ignored `.cache/k6`. It does not require a global
installation or store credentials.

```powershell
powershell -NoProfile -File scripts/loadtest-install-k6.ps1
```

On macOS or Linux, install the maintained official k6 package using Grafana's
[installation instructions](https://grafana.com/docs/k6/latest/set-up/install-k6/).
The runner also accepts a `k6` executable already available on PATH. Do not use
an unverified third-party binary or an automatically uploaded cloud test.

## Target restrictions

By default the runner targets `http://127.0.0.1:3000`. Only exact loopback
origins (`127.0.0.1`, `localhost`, `[::1]`) are accepted automatically. Other
local-network IP ranges and metadata IPs are rejected. A remote target must:

1. Use HTTPS and have an explicit `staging` hostname label or hyphenated segment.
2. Match the exact `--staging-allowlist` origin supplied by the operator.
3. Return a successful `/api/testing/environment` guard proving that load testing
   is enabled, the server environment is development/staging, and paid
   integrations are disabled. A remote target must specifically identify staging.

The guard is absent by default and in production unless the operator explicitly
configures the separate staging environment. It grants no user session, tenant
access, entitlement, or authentication bypass. A failed/missing guard prevents
all virtual users from starting. Redirects are disabled globally and per request;
the script cannot follow a staging redirect into a production site. Only HTTP
200 is an expected response. The runner strips inherited cloud-output, provider,
debug, and auth environment values from the k6 child process. Summary labels
cannot select an arbitrary file path.

## Run on an ordinary local development server

Use a clean environment with all integration enable flags false and no running
worker. Enable the explicit testing guard locally, then run the ordinary dev
server in one terminal:

```powershell
$env:LOAD_TESTING_ENABLED = 'true'
$env:DEPLOYMENT_ENV = 'development'
npm run dev
```

In another terminal:

```sh
node scripts/loadtest-run.mjs --profile smoke --label local-smoke
node scripts/loadtest-run.mjs --profile full --label local-full
```

The 20-second smoke profile verifies the guard and one-user route flow. The
100-second probe reaches each level briefly and is useful for quick feedback,
but cannot replace a sustained test:

```sh
node scripts/loadtest-run.mjs --profile probe --label local-probe
```

Development compilation and file watching can dominate latency. Use the compiled
rendering fixture below to assess the built server separately. Do not compare
development and compiled measurements as if they were the same environment.

## Isolated compiled-rendering fixture

For local production-bundle rendering measurements, the harness starts the
actual built standalone Next.js server on **loopback port 3100**, copying its
content-hashed public assets into the standalone artifact as in deployment.
It refuses to start if any
real runtime dotenv file exists in the checkout (`.env`, `.env.local`,
`.env.production`, `.env.production.local`) exists in the checkout or standalone
artifact and requires explicit acknowledgement.
It supplies only inert `.invalid` auth configuration and an ephemeral random
cookie-signing key in child memory. No auth mock or production bypass is added to
the application. Real auth or protected-workspace calls cannot succeed against
that inert provider; the benchmark uses only public/demo routes. All paid
integrations are explicitly disabled, and no database URL or worker is supplied.

```sh
npm run build
node scripts/loadtest-server.mjs --confirm-isolated-local
```

In a separate terminal:

```sh
node scripts/loadtest-run.mjs --base-url http://127.0.0.1:3100 --profile smoke --label compiled-smoke
node scripts/loadtest-run.mjs --base-url http://127.0.0.1:3100 --profile full --label compiled-full
```

Stop the owned harness with Ctrl+C when finished. This harness is a local testing
fixture, not an application deployment command and not a valid live configuration.
The production web/worker deployment commands in README remain fail-closed with
missing real configuration.

## Full profile and pass/fail criteria

| Phase     | Ramp / hold | Users    |
| --------- | ----------- | -------- |
| Ramp      | 30 seconds  | 0 → 20   |
| Hold      | 2 minutes   | 20       |
| Ramp      | 30 seconds  | 20 → 50  |
| Hold      | 2 minutes   | 50       |
| Ramp      | 30 seconds  | 50 → 100 |
| Hold      | 2 minutes   | 100      |
| Ramp down | 30 seconds  | 100 → 0  |

Requested thresholds are enforced: `http_req_duration p(95)<500` ms and
`http_req_failed rate<0.01`. Each hold and each journey step also gets a p95
threshold so a fast landing page cannot hide a slow inbox. Failures, durations,
and samples are reported per hold. An emergency circuit breaker stops the run
after its initial 30 seconds if errors exceed 25% or request p95 reaches 10
seconds, rather than repeatedly overwhelming a failing local service. A missing
stage is reported as not reached, never as a successful zero-latency result.

The process exits nonzero for a failed performance threshold; this is a measured
result, not a script implementation failure. Do not remove thresholds to make a
slow result appear green. The script does not keep increasing above 100 users
when the machine is already failing.

## Read the results

Only sanitized aggregate JSON is written to
`.cache/load-tests/<label>.json`: profile, sample counts, p95 timings, failure
rates, per-level/per-step metrics, and threshold outcomes. No response bodies,
customer data, cookies, authorization values, provider keys, or environment dump
is exported. CLI progress announces the current phase. Local reports remain
ignored; include reviewed aggregate numbers in the performance report instead
of uploading raw logs or trace archives.

Find the first hold whose p95 is at least 500 ms or whose failure rate reaches
1%. Its per-step timings identify which route slowed first. If all requested
levels pass, the breaking point is **not found up to 100 users**; it is not safe
to invent one. If setup fails or an emergency stop occurs before a hold, that
level's capacity is **not measured**. The load generator and app share one local
machine, so CPU contention, Windows scheduling, and local network limits can
distort the result. Repeat in isolated staging with the actual host plan and an
isolated synthetic Auth/database before making production sizing decisions.

## Executed local checks on 2026-11-01

The fixture ran the compiled standalone artifact on loopback, with all paid
integrations disabled and no database or worker. The load generator and server
shared this Windows machine: Intel Core i5-12500H, 16 logical processors,
15.7 GiB RAM, Windows 10.0.26300, Node 26.8.1, and k6 2.3.0. Hardware was read
through Node's OS API; it is not the specification of a deployed host.

- The one-user smoke run completed 20 measured journey requests, zero failures,
  and an overall HTTP p95 of 40.97 ms. Its ten-second steady hold had 13 samples
  and p95 19.78 ms. This tiny sample proves the harness/request path, not capacity.
- Two Playwright production-artifact HTTP checks passed: per-visitor nonce HTML
  and private APIs stayed uncached, while content-hashed static assets returned
  `public, max-age=31536000, immutable` without cookies.
- The full staged run completed successfully (k6 exit 0) with **28,025 measured
  journey requests**, **0% HTTP failures**, and overall HTTP **p95 40.42 ms**.
  Every global, per-hold, and per-step threshold passed. The run began at
  00:40:20 IST and completed all configured two-minute holds and ramp-down.

| Sustained users | Hold        | Measured requests | Hold p95 | Failures | Slowest step p95   |
| --------------- | ----------- | ----------------- | -------- | -------- | ------------------ |
| 20              | 120 seconds | 2,640             | 20.68 ms | 0%       | Overview, 22.10 ms |
| 50              | 120 seconds | 6,572             | 29.47 ms | 0%       | Overview, 30.35 ms |
| 100             | 120 seconds | 13,022            | 46.74 ms | 0%       | Overview, 48.52 ms |

**No breaking point was found up to 100 virtual users for this read-only local
rendering workload.** Latency rose with load but remained far below the 500 ms
threshold. Nothing failed first in this test; the overview was merely the
slowest measured step, not an identified saturated bottleneck. No server CPU or
memory utilization claim is made. The reviewed sanitized aggregate is in
`.cache/load-tests/compiled-full.json` (intentionally ignored by Git); the table
above preserves its relevant numbers in the handoff.

The first practical follow-up is an isolated staging run with authenticated
synthetic users and an actual PostgreSQL database, including tenant-scoped
workspace reads and safe database-only writes, followed separately by a bounded
queue test. Do not enable paid integrations merely to make this HTTP test look
more representative. Use the database query-plan timings and connection budget
report to prioritize database work; these demo numbers cannot rank the live
database, authentication, queue, or provider bottlenecks.

Hosted PostgreSQL/auth/queue/provider stress is not measured merely because
these HTTP steps complete.

Official references:

- [Ramping virtual users](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/)
- [Thresholds and emergency abort](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [Setup lifecycle](https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/)
- [HTTP requests and redirects](https://grafana.com/docs/k6/latest/using-k6/http-requests/)
- [Custom sanitized summaries](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/)
