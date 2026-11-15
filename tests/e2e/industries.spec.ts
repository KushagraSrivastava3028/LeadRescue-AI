import { test, expect } from '@playwright/test';

test('industry demos persist and drive enquiry services, appointment labels and preview replies', async ({
  page,
}) => {
  const paidMutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/'))
      paidMutations.push(request.url());
  });
  await page.goto('/demo');
  await page.getByLabel('Load sample industry', { exact: true }).selectOption('plumbing');
  await expect(page.locator('.workspace-switcher')).toContainText('Summit Plumbing');
  await page.goto('/demo/leads');
  await page.getByRole('button', { name: 'New enquiry', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Service', exact: true }),
  ).toContainText('Drain cleaning');
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Service', exact: true }),
  ).not.toContainText('Roof');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/demo/calendar');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.agenda-list')).toContainText('Plumbing assessment');
  await page.goto('/demo/assistant');
  await page.getByPlaceholder(/Can you help with/).fill('Please help with my drain');
  await page.getByPlaceholder(/Can you help with/).press('Enter');
  await expect(page.getByText(/Thanks for getting in touch with Summit Plumbing/)).toBeVisible();
  await expect(page.getByText(/Thanks for getting in touch with Summit Plumbing/)).toContainText(
    'Which fixture or area',
  );
  await page.reload();
  await expect(page.getByLabel('Load sample industry', { exact: true })).toHaveValue('plumbing');
  expect(paidMutations).toEqual([]);
});

test('custom industry settings save and drive forms without rewriting historic leads', async ({
  page,
}) => {
  await page.goto('/demo/settings');
  await page.getByLabel('Industry', { exact: true }).selectOption('custom');
  await page.getByRole('button', { name: 'Apply industry defaults', exact: true }).click();
  await page.getByLabel('Business name', { exact: true }).fill('Acme Appliance Care');
  await page.getByLabel(/Services offered/).fill('Washer repair, Dryer repair');
  await page.getByLabel('Appointment label', { exact: true }).fill('Appliance assessment');
  await page.getByLabel(/Intake questions/).fill('Which appliance needs attention?');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Demo settings saved');
  await page.reload();
  await expect(page.getByLabel('Industry', { exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('Appointment label', { exact: true })).toHaveValue(
    'Appliance assessment',
  );
  await page.goto('/demo/leads');
  await expect(page.locator('.enquiry-row').filter({ hasText: 'Jessica Wilson' })).toContainText(
    'Roof leak',
  );
  await page.getByRole('button', { name: 'New enquiry', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Service', exact: true })
    .selectOption('Washer repair');
  await page.getByRole('dialog').getByLabel('Customer name').fill('Pat Appliance');
  await page.getByRole('dialog').getByLabel('Phone number').fill('(202) 555-0112');
  await page.getByRole('button', { name: 'Add demo enquiry', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search leads' }).fill('Pat Appliance');
  await expect(page.locator('.enquiry-row')).toContainText('Washer repair');
});

test('industry selection works on mobile and presets require an explicit apply action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByLabel('Load sample industry', { exact: true }).selectOption('electrical');
  await page.locator('.sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel(/Services offered/)).toHaveValue(/Electrical repair/);
  await page.getByLabel('Industry', { exact: true }).selectOption('cleaning');
  await expect(page.getByLabel(/Services offered/)).toHaveValue(/Electrical repair/);
  await page.getByRole('button', { name: 'Apply industry defaults', exact: true }).click();
  await expect(page.getByLabel(/Services offered/)).toHaveValue(/Home cleaning/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
