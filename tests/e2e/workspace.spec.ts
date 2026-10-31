import { test, expect, type Page } from '@playwright/test';

const syntheticEmail = 'qa.synthetic@example.test';

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(
    dimensions.document,
    `${new URL(page.url()).pathname}: document should fit the viewport`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(
    dimensions.body,
    `${new URL(page.url()).pathname}: body should fit the viewport`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('public landing, pricing FAQs and demo form a working discovery path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Missed the call/ })).toBeVisible();
  await page.locator('.public-header').getByRole('link', { name: 'Pricing', exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  const usageQuestion = page.getByRole('button', {
    name: 'Are there any usage limits?',
    exact: true,
  });
  await usageQuestion.click();
  await expect(usageQuestion).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Automation pauses at your limit/)).toBeVisible();
  await usageQuestion.click();
  await expect(usageQuestion).toHaveAttribute('aria-expanded', 'false');
  await page
    .getByRole('button', { name: 'Will it text every missed caller?', exact: true })
    .click();
  await expect(page.getByText(/A missed call alone does not grant SMS consent/)).toBeVisible();
  await page.getByRole('link', { name: 'LeadRescue home' }).first().click();
  await page.getByRole('link', { name: 'Explore the demo', exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your missed calls.');
  await expect(page.getByText('Demo workspace', { exact: true })).toBeVisible();
  await expect(
    page.getByText('All figures are illustrative demo data.', { exact: true }),
  ).toBeVisible();
});

test('demo filters and selection work, and takeover typing keeps focus without sending an SMS', async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/'))
      mutations.push(new URL(request.url()).pathname);
  });
  await page.goto('/demo/inbox');
  await expect(page.getByRole('heading', { name: 'Jessica Wilson', exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('Daniel');
  await expect(page.locator('.inbox-item')).toHaveCount(1);
  await page.getByRole('button', { name: /Daniel Brooks/ }).click();
  await expect(page.getByRole('heading', { name: 'Daniel Brooks', exact: true })).toBeVisible();
  await search.fill('');
  await page.getByRole('button', { name: 'Booked', exact: true }).click();
  await expect(page.locator('.inbox-item')).toHaveCount(1);
  await expect(page.locator('.inbox-item')).toContainText('Daniel Brooks');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: /Jessica Wilson/ }).click();
  const reply = page.getByRole('textbox', { name: 'Reply message' });
  await expect(reply).toBeDisabled();
  await page.getByRole('button', { name: 'Take over conversation', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume AI assistant', exact: true }),
  ).toBeVisible();
  await expect(reply).toBeEnabled();
  const message = 'Synthetic QA reply: we can call you at 2 PM.';
  await reply.click();
  await reply.pressSequentially(message, { delay: 10 });
  await expect(reply).toHaveValue(message);
  await expect(reply).toBeFocused();
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.locator('.chat-bubble').filter({ hasText: message })).toBeVisible();
  await expect(reply).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('No SMS was sent.');
  expect(mutations).toEqual([]);
  await page.reload();
  await expect(page.locator('.chat-bubble').filter({ hasText: message })).toBeVisible();
});

test('demo enquiries persist and customer text remains inert when rendered', async ({ page }) => {
  await page.goto('/demo/leads');
  await page.getByRole('button', { name: 'New enquiry', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const customer = 'Taylor Synthetic';
  const note = '<img src=x onerror=window.__leadrescueXss=1> Synthetic note.';
  await dialog.getByLabel('Customer name').fill(customer);
  await dialog.getByLabel('Phone number').fill('(202) 555-0112');
  await dialog
    .getByRole('combobox', { name: 'Service', exact: true })
    .selectOption('Roof inspection');
  await dialog.getByLabel('City', { exact: true }).fill('Dallas, TX');
  await dialog.getByLabel('ZIP code', { exact: true }).fill('75201');
  await dialog.getByLabel('Notes', { exact: true }).fill(note);
  await dialog.getByRole('button', { name: 'Add demo enquiry', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Search leads' }).fill(customer);
  await expect(page.locator('.enquiry-row')).toHaveCount(1);
  await page.getByRole('button', { name: new RegExp(customer) }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { __leadrescueXss?: number }).__leadrescueXss),
  ).toBeUndefined();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search leads' }).fill(customer);
  await expect(page.locator('.enquiry-row')).toHaveCount(1);
  await expect(page.locator('.enquiry-row')).toContainText(customer);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('leadrescue-demo-v1') ?? '{}'),
  );
  expect(saved.leads.find((lead: { name: string }) => lead.name === customer).consent).toBe(false);
});

test('demo business settings save locally and survive reload', async ({ page }) => {
  await page.goto('/demo/settings');
  await page.getByLabel('Business name', { exact: true }).fill('Synthetic Ridge Roofing');
  await page.getByLabel(/Services offered/).fill('Roof repair, Roof inspection');
  await page.getByLabel('Service area ZIP codes', { exact: true }).fill('75201, 75204');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Demo settings saved in this browser.');
  await page.reload();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue(
    'Synthetic Ridge Roofing',
  );
  await expect(page.getByLabel(/Services offered/)).toHaveValue('Roof repair, Roof inspection');
  await expect(page.getByLabel('Service area ZIP codes', { exact: true })).toHaveValue(
    '75201, 75204',
  );
  await expect(page.locator('.workspace-switcher')).toContainText('Synthetic Ridge Roofing');
});

test('calendar saves a demo inspection request and shows it in the agenda', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/'))
      mutations.push(new URL(request.url()).pathname);
  });
  await page.goto('/demo/calendar');
  await page.getByRole('button', { name: 'Request inspection', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Customer', exact: true })
    .selectOption('demo-jessica');
  await dialog.getByLabel('Date', { exact: true }).fill('2026-11-02');
  await dialog.getByLabel('Time', { exact: true }).fill('10:30');
  await expect(dialog).toContainText('No real calendar event is created.');
  await dialog.getByRole('button', { name: 'Save inspection request', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No calendar event was created.');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const row = page.locator('.agenda-list > div').filter({ hasText: 'Jessica Wilson' });
  await expect(row).toContainText('10:30');
  await expect(row).toContainText('Demo Request');
  await page.reload();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.agenda-list')).toContainText('Jessica Wilson');
  expect(mutations).toEqual([]);
});

test('mobile navigation and all main routes fit a 390px viewport', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await page.locator('.sidebar').getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/leads$/);
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await noHorizontalOverflow(page);
  for (const path of [
    '/demo',
    '/demo/inbox',
    '/demo/leads',
    '/demo/calendar',
    '/demo/assistant',
    '/demo/settings',
    '/demo/billing',
    '/',
    '/pricing',
    '/signin',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/two-factor',
  ]) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

test('missing auth configuration returns a generic error and never pretends to sign in', async ({
  page,
}) => {
  await page.goto('/signin');
  await page.getByLabel('Work email', { exact: true }).fill(syntheticEmail);
  await page.getByPlaceholder('Enter your password').fill('SyntheticPassword123!');
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(503);
  await expect(page.locator('.auth-card').getByRole('alert')).toContainText(
    'This service is not configured yet.',
  );
  await expect(page).toHaveURL(/\/signin$/);
  const body = await response.text();
  expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|stack|SyntheticPassword/);
});

test('actual HTTP responses enforce nonce CSP and browser security headers', async ({
  request,
}) => {
  const first = await request.get('/');
  const second = await request.get('/');
  expect(first.status()).toBe(200);
  const a = first.headers();
  const b = second.headers();
  const nonce = a['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1];
  const nextNonce = b['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(nextNonce).toBeTruthy();
  expect(nonce).not.toBe(nextNonce);
  expect(a['content-security-policy']).toContain("'strict-dynamic'");
  expect(a['content-security-policy']).toContain("object-src 'none'");
  expect(a['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(a['content-security-policy']).toContain("form-action 'self'");
  if (a['content-security-policy'].includes('upgrade-insecure-requests'))
    expect(a['content-security-policy']).not.toContain("'unsafe-eval'");
  expect(a['x-content-type-options']).toBe('nosniff');
  expect(a['x-frame-options']).toBe('DENY');
  expect(a['referrer-policy']).toBeTruthy();
  expect(a['permissions-policy']).toContain('camera=()');
  expect(a['cache-control']).toContain('no-store');
  expect(a['x-request-id']).toBeTruthy();
  const html = await first.text();
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  expect(scriptTags.length).toBeGreaterThan(0);
  for (const tag of scriptTags) expect(tag).toContain(`nonce="${nonce}"`);
});

test('cross-origin mutations, forged fields, protected pages and exposed files fail safely', async ({
  page,
  request,
  baseURL,
}) => {
  const rejected = await request.post('/api/auth', {
    headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' },
    data: { action: 'signout' },
  });
  expect(rejected.status()).toBe(403);
  expect((await rejected.json()).code).toBe('origin_rejected');
  const forged = await request.post('/api/workspace', {
    headers: { Origin: baseURL!, 'Content-Type': 'application/json' },
    data: {
      action: 'create-business',
      name: 'Synthetic',
      timezone: 'America/Chicago',
      zipCodes: ['75201'],
      role: 'owner',
      paid: true,
    },
  });
  expect(forged.status()).toBe(400);
  const protectedResponse = await request.get('/app', { maxRedirects: 0 });
  expect([307, 308]).toContain(protectedResponse.status());
  expect(protectedResponse.headers().location).toContain('/signin');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect workspace' })).toHaveCount(0);
  const admin = await request.get('/api/admin');
  expect([401, 403, 503]).toContain(admin.status());
  expect(await admin.text()).not.toContain('"authorized":true');
  for (const path of [
    '/.env',
    '/.env.local',
    '/.git/HEAD',
    '/.git/config',
    '/package-lock.json',
    '/supabase/seed.sql',
    '/.next/server/server-reference-manifest.json',
    '/_next/server/preview-props.json',
  ]) {
    const response = await request.get(path);
    expect(response.status(), `${path} must not be publicly served`).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/^ref: refs\//m);
    expect(body).not.toMatch(/^\[core\]/m);
    expect(body).not.toContain('"lockfileVersion"');
  }
});
