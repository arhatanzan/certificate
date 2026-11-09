import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

const id = 'FORM-1794220000000-' + 'A'.repeat(32);
const events = [
  { id: 'instant', title: 'Design Foundations', date: '2026-11-20', category: 'Instant', issuer: 'Open Workshop' },
  { id: 'review', title: 'Community Fellowship', date: '2026-11-28', category: 'Review', issuer: 'Open Workshop' }
];
const certificate = { id, name: 'Alex Morgan', eventId: 'instant', eventTitle: 'Design Foundations', eventDate: '2026-11-20', approvedAt: '2026-11-09T12:00:00Z', issuer: 'Open Workshop', flag: 1 };

async function mockApi(page) {
  const rows = [];
  let publishedTemplate = null;
  await page.route('**/config.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("apiUrl: ''", "apiUrl: 'https://script.google.com/macros/s/test/exec'") });
  });
  await page.route('https://script.google.com/**', async route => {
    const request = route.request();
    const body = request.method() === 'POST' ? request.postDataJSON() : Object.fromEntries(new URL(request.url()).searchParams);
    let result = { ok: true };
    if (body.action === 'template') result.template = publishedTemplate;
    if (body.action === 'saveTemplate') { publishedTemplate = body.template; result.saved = true; }
    if (body.action === 'events') result.events = events;
    if (body.action === 'submit') {
      const approved = body.eventId === 'instant';
      rows.push({ id: body.id, name: body.name, email: body.email, flag: approved ? 1 : 0 });
      result = { ok: true, id: body.id, approved, certificate: approved ? { ...certificate, id: body.id, name: body.name } : null };
    }
    if (body.action === 'verify' || body.action === 'download') result.certificate = certificate;
    if (body.action === 'login') result.session = 'test-session';
    if (body.action === 'list') result.submissions = [{ id, name: 'Alex Morgan', email: 'alex@example.com', event_title: 'Community Fellowship', created_at: '2026-11-09T12:00:00Z', flag: 0, notification_status: 'pending', last_error: '' }];
    if (body.action === 'approve') result.submission = { id, name: 'Alex Morgan', email: 'alex@example.com', event_title: 'Community Fellowship', created_at: '2026-11-09T12:00:00Z', flag: body.flag, notification_status: 'sent', last_error: '' };
    await route.fulfill({ json: result, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return rows;
}

async function fillForm(page, event) {
  await page.getByLabel('Full name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Email address').fill('alex@example.com');
  await page.getByLabel('Workshop or program').selectOption(event);
  await page.getByRole('checkbox').check();
}

test('instant form downloads a valid A4 landscape PDF', async ({ page }) => {
  const rows = await mockApi(page);
  await page.goto('/');
  await fillForm(page, 'instant');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Get my certificate' }).click();
  await expect(page.getByRole('heading', { name: 'You earned it.' })).toBeVisible();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPages()).toHaveLength(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(841.89);
  expect(pdf.getPage(0).getHeight()).toBeCloseTo(595.28);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toMatch(/^FORM-\d{13}-[A-F0-9]{32}$/);
});

test('review receives a tracking ID without issuing a PDF', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await fillForm(page, 'review');
  await page.getByRole('button', { name: 'Get my certificate' }).click();
  await expect(page.getByRole('heading', { name: 'Submission received' })).toBeVisible();
  await expect(page.locator('#result code')).toContainText('FORM-');
  await expect(page.getByRole('button', { name: 'Download certificate' })).toHaveCount(0);
});

test('a definite validation rejection allows corrected details', async ({ page }) => {
  await mockApi(page);
  let submissions = 0;
  await page.route('https://script.google.com/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON().action !== 'submit') { await route.fallback(); return; }
    submissions++;
    if (submissions === 1) {
      await route.fulfill({ json: { ok: false, error: { code: 'BAD_REQUEST', message: 'Enter a valid email address.' } }, headers: { 'Access-Control-Allow-Origin': '*' } });
    } else await route.fallback();
  });
  await page.goto('/');
  await fillForm(page, 'review');
  await page.getByRole('button', { name: 'Get my certificate' }).click();
  await expect(page.locator('#status')).toContainText('Enter a valid email address.');
  await page.getByLabel('Email address').fill('corrected@example.com');
  await page.getByRole('button', { name: 'Retry submission' }).click();
  await expect(page.getByRole('heading', { name: 'Submission received' })).toBeVisible();
  expect(submissions).toBe(2);
});

test('verification and approval-email deep links work', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/?route=verify&id=${id}`);
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
  await expect(page.getByText('Verified certificate', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.goto(`/?route=download&id=${id}`);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${id}.pdf`);
});

test('admin signs in, filters, approves and signs out', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?route=admin');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByLabel('Username', { exact: true }).fill('organizer');
  await page.getByLabel('Password', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: 'Pending', exact: true }).click();
  await page.getByRole('switch').click();
  await expect(page.getByText('No submissions found.')).toBeVisible();
  await page.getByRole('button', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('switch')).toBeChecked();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
});

test('registration is responsive and key assets render', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByLabel('Workshop or program')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const image = page.getByAltText('Workshop participants collaborating around a table');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('registration.png'), fullPage: true });
});

test('admin uploads, positions, previews and publishes a persistent template', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/?route=admin');
  await page.getByLabel('Username', { exact: true }).fill('organizer');
  await page.getByLabel('Password', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish template' })).toBeEnabled();
  await page.locator('#template-artwork').setInputFiles('public/assets/green.jpg');
  await expect(page.locator('#template-status')).toContainText('Artwork loaded.');
  await expect(page.getByLabel('Include sample headings')).not.toBeChecked();
  await page.getByLabel('Vertical position (pt)').fill('330');
  await page.getByLabel('Font size (pt)').fill('32');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download preview PDF' }).click();
  const download = await downloadPromise;
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  expect(pdf.getPages()).toHaveLength(1);
  await page.getByRole('button', { name: 'Publish template' }).click();
  await expect(page.locator('#template-status')).toContainText('Template published.');
  await page.getByRole('button', { name: 'Submissions', exact: true }).click();
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish template' })).toBeEnabled();
  await expect(page.getByLabel('Vertical position (pt)')).toHaveValue('330');
  await expect(page.getByLabel('Font size (pt)')).toHaveValue('32');
  const pixel = await page.locator('#template-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(40, 40, 1, 1).data]);
  expect(pixel[3]).toBe(255);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('template-editor.png'), fullPage: true });
});

test('a missing background can be replaced without editing configuration files', async ({ page }) => {
  await mockApi(page);
  await page.route('**/assets/green.jpg', route => route.fulfill({ status: 404, body: 'Missing image' }));
  await page.goto('/?route=admin');
  await page.getByLabel('Username', { exact: true }).fill('organizer');
  await page.getByLabel('Password', { exact: true }).fill('test-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await expect(page.locator('#template-status')).toContainText('background could not be loaded');
  await expect(page.locator('#template-artwork')).toBeEnabled();
  await page.locator('#template-artwork').setInputFiles('public/assets/green.jpg');
  await expect(page.getByRole('button', { name: 'Publish template' })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish template' }).click();
  await expect(page.locator('#template-status')).toContainText('Template published.');
});