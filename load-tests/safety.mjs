export const JOURNEY_STEPS = Object.freeze([
  { name: 'landing', path: '/' },
  { name: 'pricing', path: '/pricing' },
  { name: 'overview', path: '/demo' },
  { name: 'leads', path: '/demo/leads' },
  { name: 'inbox', path: '/demo/inbox' },
]);

const profiles = {
  smoke: [
    { duration: '5s', seconds: 5, target: 1, name: 'ramp_to_1' },
    { duration: '10s', seconds: 10, target: 1, name: 'hold_1' },
    { duration: '5s', seconds: 5, target: 0, name: 'ramp_down' },
  ],
  probe: [
    { duration: '10s', seconds: 10, target: 20, name: 'ramp_to_20' },
    { duration: '20s', seconds: 20, target: 20, name: 'hold_20' },
    { duration: '10s', seconds: 10, target: 50, name: 'ramp_to_50' },
    { duration: '20s', seconds: 20, target: 50, name: 'hold_50' },
    { duration: '10s', seconds: 10, target: 100, name: 'ramp_to_100' },
    { duration: '20s', seconds: 20, target: 100, name: 'hold_100' },
    { duration: '10s', seconds: 10, target: 0, name: 'ramp_down' },
  ],
  full: [
    { duration: '30s', seconds: 30, target: 20, name: 'ramp_to_20' },
    { duration: '2m', seconds: 120, target: 20, name: 'hold_20' },
    { duration: '30s', seconds: 30, target: 50, name: 'ramp_to_50' },
    { duration: '2m', seconds: 120, target: 50, name: 'hold_50' },
    { duration: '30s', seconds: 30, target: 100, name: 'ramp_to_100' },
    { duration: '2m', seconds: 120, target: 100, name: 'hold_100' },
    { duration: '30s', seconds: 30, target: 0, name: 'ramp_down' },
  ],
};

/** No arbitrary path, userinfo, query string, IP range, or production origin. */
export function validateTarget(input, stagingAllowlist = '') {
  const value = String(input || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const local = /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::([1-9]\d{0,4}))?$/.exec(value);
  if (local) {
    if (local[3] && Number(local[3]) > 65535) throw new Error('Invalid local port.');
    return { origin: value, kind: 'local' };
  }
  const remote = /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::443)?$/.exec(value);
  if (!remote || remote[1].includes('..'))
    throw new Error('Only loopback or an explicitly approved HTTPS staging origin is allowed.');
  const labels = remote[1].split('.');
  if (!labels.some((label) => /(^|-)staging($|-)/.test(label)))
    throw new Error(
      'Remote hostname must explicitly identify staging. Production targets are refused.',
    );
  if (String(stagingAllowlist).replace(/\/$/, '') !== value)
    throw new Error('The exact staging origin must also be explicitly allowlisted.');
  return { origin: value, kind: 'staging' };
}

export function validateEnvironmentGuard(payload, targetKind) {
  if (!payload || payload.loadTestingEnabled !== true || payload.paidIntegrationsDisabled !== true)
    throw new Error('The server did not prove that guarded, cost-free load testing is enabled.');
  const allowed = targetKind === 'local' ? ['development', 'staging'] : ['staging'];
  if (!allowed.includes(payload.environment))
    throw new Error('Production or an unknown server environment is refused.');
  return true;
}

export function loadProfile(name = 'full') {
  if (!Object.hasOwn(profiles, name)) throw new Error('Choose full, probe, or smoke.');
  return profiles[name].map((stage) => ({ ...stage }));
}

export function phaseAt(stages, elapsedMilliseconds) {
  let seconds = Math.max(0, elapsedMilliseconds) / 1000;
  for (const stage of stages) {
    if (seconds < stage.seconds) return stage.name;
    seconds -= stage.seconds;
  }
  return 'ramp_down';
}

export function summaryLabel(input = 'latest') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input))
    throw new Error('Summary label must be a simple local filename label.');
  return input;
}
