import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  JOURNEY_STEPS,
  loadProfile,
  phaseAt,
  summaryLabel,
  validateEnvironmentGuard,
  validateTarget,
} from './safety.mjs';

// A redirect is an unexpected response, not a successful journey step.
http.setResponseCallback(http.expectedStatuses(200));

const target = validateTarget(__ENV.BASE_URL, __ENV.ALLOWED_STAGING_ORIGIN);
const profileName = __ENV.PROFILE || 'full';
const stages = loadProfile(profileName);
const label = summaryLabel(__ENV.SUMMARY_LABEL || 'latest');
const requestLatency = new Trend('journey_request_ms', true);
const requestFailure = new Rate('journey_failed');
const requestCount = new Counter('journey_requests');
let loggedPhase = '';
const thresholds = {
  http_req_duration: ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  journey_request_ms: [{ threshold: 'p(95)<10000', abortOnFail: true, delayAbortEval: '30s' }],
  journey_failed: [{ threshold: 'rate<0.25', abortOnFail: true, delayAbortEval: '30s' }],
};
for (const stage of stages) {
  if (stage.name.startsWith('hold_')) {
    thresholds[`journey_request_ms{phase:${stage.name}}`] = ['p(95)<500'];
    thresholds[`journey_failed{phase:${stage.name}}`] = ['rate<0.01'];
    thresholds[`journey_requests{phase:${stage.name}}`] = ['count>=1'];
    for (const step of JOURNEY_STEPS)
      thresholds[`journey_request_ms{phase:${stage.name},step:${step.name}}`] = ['p(95)<500'];
  }
}
for (const step of JOURNEY_STEPS)
  thresholds[`journey_request_ms{step:${step.name}}`] = ['p(95)<500'];

export const options = {
  scenarios: {
    customer_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: stages.map((s) => ({ duration: s.duration, target: s.target })),
      gracefulRampDown: '5s',
      gracefulStop: '10s',
    },
  },
  thresholds,
  maxRedirects: 0,
  discardResponseBodies: true,
  summaryTrendStats: ['med', 'p(95)', 'max'],
  setupTimeout: '60s',
  userAgent: 'LeadRescue-authorized-local-staging-load-test/1.0',
};

export function setup() {
  const response = http.get(`${target.origin}/api/testing/environment`, {
    redirects: 0,
    timeout: '10s',
    responseType: 'text',
    tags: { name: 'environment_guard', phase: 'setup' },
  });
  if (response.status !== 200)
    throw new Error('Load-test guard unavailable. No virtual users started.');
  let payload;
  try {
    payload = response.json();
  } catch {
    throw new Error('Load-test guard returned invalid JSON.');
  }
  validateEnvironmentGuard(payload, target.kind);
  for (const step of JOURNEY_STEPS) {
    const warmed = http.get(`${target.origin}${step.path}`, {
      redirects: 0,
      timeout: '15s',
      tags: { name: `warmup_${step.name}`, phase: 'setup' },
    });
    if (warmed.status !== 200)
      throw new Error(`Warmup failed for ${step.name}. No virtual users started.`);
  }
  console.log(
    `Guard verified: ${target.kind}, no paid integrations; ${profileName} profile, max ${Math.max(...stages.map((s) => s.target))} VUs.`,
  );
}

export default function customerJourney() {
  for (const step of JOURNEY_STEPS) {
    const phase = phaseAt(stages, Date.now() - exec.scenario.startTime);
    if (exec.vu.idInTest === 1 && phase !== loggedPhase) {
      console.log(`Phase ${phase}; active VUs=${exec.instance.vusActive}`);
      loggedPhase = phase;
    }
    const tags = { step: step.name, phase, name: step.name };
    const response = http.get(`${target.origin}${step.path}`, {
      redirects: 0,
      timeout: '10s',
      tags,
    });
    const ok =
      response.status === 200 &&
      String(response.headers['Content-Type'] || '').includes('text/html');
    check(response, { [`${step.name}:200 HTML`]: () => ok }, tags);
    requestCount.add(1, tags);
    requestLatency.add(response.timings.duration, tags);
    requestFailure.add(!ok, tags);
    sleep(0.6 + Math.random() * 0.6);
  }
}

export function handleSummary(data) {
  const metrics = data.metrics || {};
  const values = (name) => metrics[name]?.values || {};
  const stageRows = stages
    .filter((s) => s.name.startsWith('hold_'))
    .map((s) => ({
      stage: s.name,
      virtualUsers: s.target,
      holdSeconds: s.seconds,
      requests: values(`journey_requests{phase:${s.name}}`).count || 0,
      p95Ms: values(`journey_request_ms{phase:${s.name}}`)['p(95)'] ?? null,
      failureRate: values(`journey_failed{phase:${s.name}}`).rate ?? null,
      steps: JOURNEY_STEPS.map((step) => ({
        step: step.name,
        p95Ms: values(`journey_request_ms{phase:${s.name},step:${step.name}}`)['p(95)'] ?? null,
      })),
    }));
  const stepRows = JOURNEY_STEPS.map((step) => ({
    step: step.name,
    p95Ms: values(`journey_request_ms{step:${step.name}}`)['p(95)'] ?? null,
  }));
  const report = {
    profile: profileName,
    scope:
      'Public and synthetic demo HTTP rendering only; no authenticated database/provider throughput is established.',
    targetKind: target.kind,
    requests: values('journey_requests').count || 0,
    p95Ms: values('http_req_duration')['p(95)'] ?? null,
    failureRate: values('http_req_failed').rate ?? null,
    stages: stageRows,
    steps: stepRows,
    thresholds: Object.fromEntries(
      Object.entries(metrics)
        .filter(([, m]) => m.thresholds)
        .map(([name, m]) => [name, m.thresholds]),
    ),
  };
  const lines = [
    `\n${profileName} load result: ${report.requests} measured journey requests, p95=${report.p95Ms?.toFixed(2) ?? 'N/A'}ms, failures=${report.failureRate ?? 'N/A'}`,
    ...stageRows.map(
      (r) =>
        `${r.stage}: VUs=${r.virtualUsers}, requests=${r.requests}, p95=${r.p95Ms?.toFixed(2) ?? 'not reached'}ms, failures=${r.failureRate ?? 'not reached'}`,
    ),
    'Scope: synthetic demo/public rendering; not production, database, auth, queue, or provider capacity.',
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    [`.cache/load-tests/${label}.json`]: JSON.stringify(report, null, 2),
  };
}
