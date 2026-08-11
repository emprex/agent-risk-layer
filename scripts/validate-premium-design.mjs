import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3311';
const viewports = [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
];
const publicPages = ['/', '/demo.html', '/pricing.html', '/trust.html', '/help.html', '/assessment.html', '/auth.html', '/sample-report.html', '/methodology.html', '/quickstart.html', '/company.html', '/status.html'];
const appPages = ['/dashboard.html', '/workspaces.html', '/control-plane.html', '/inspector.html', '/redteam.html', '/control-intelligence.html'];

const browser = await chromium.launch({ headless: true });
const report = { public: [], authenticated: [], assertions: [] };

async function auditPage(context, path, width, { expectAuth = false } = {}) {
  const page = await context.newPage();
  const consoleErrors = [];
  const serverErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(base).origin && response.status() >= 500) serverErrors.push(`${response.status()} ${url.pathname}`);
  });
  const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
  assert.ok(response, `Missing response for ${path}`);
  assert.ok(response.status() < 500, `${path} returned ${response.status()}`);
  if (expectAuth) assert.equal(new URL(page.url()).pathname, path, `${path} unexpectedly redirected`);
  const state = await page.evaluate(() => {
    const viewport = innerWidth;
    const overflowElements = [...document.querySelectorAll('body *')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().replace(/\s+/g, '.')}` : ''}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          position: style.position,
          overflowX: style.overflowX,
        };
      })
      .filter((item) => item.width > 0 && (item.right > viewport + 1 || item.left < -1))
      .sort((a, b) => b.width - a.width)
      .slice(0, 12);
    return {
      path: location.pathname,
      viewport,
      htmlWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      premiumLink: Boolean(document.querySelector('link[data-arl-premium-theme]')),
      premiumMediaLink: Boolean(document.querySelector('link[data-arl-premium-media]')),
      brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
      hiddenViolations: [...document.querySelectorAll('[hidden]')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.id || el.className || el.tagName).slice(0, 10),
      overflowElements,
    };
  });
  assert.equal(state.premiumLink, true, `${path} premium stylesheet was not loaded`);
  assert.equal(state.premiumMediaLink, true, `${path} premium media stylesheet was not loaded`);
  assert.equal(state.brand.toLowerCase(), '#16b8ff', `${path} premium brand token missing`);
  assert.ok(state.htmlWidth <= state.viewport + 1, `${path} html overflow at ${width}: ${state.htmlWidth}/${state.viewport}; offenders=${JSON.stringify(state.overflowElements)}`);
  assert.ok(state.bodyWidth <= state.viewport + 1, `${path} body overflow at ${width}: ${state.bodyWidth}/${state.viewport}; offenders=${JSON.stringify(state.overflowElements)}`);
  assert.deepEqual(state.hiddenViolations, [], `${path} has visible [hidden] controls`);
  assert.deepEqual(serverErrors, [], `${path} same-origin 5xx errors: ${serverErrors.join(', ')}`);
  assert.deepEqual(consoleErrors, [], `${path} console errors: ${consoleErrors.join(' | ')}`);
  await page.close();
  return state;
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    for (const path of publicPages) report.public.push(await auditPage(context, path, viewport.width));
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const register = await context.newPage();
  const email = `premium-${Date.now()}@example.test`;
  const password = 'Premium-Visual-Validation-42!';
  await register.goto(`${base}/auth.html?mode=register`, { waitUntil: 'networkidle' });
  await register.fill('#registerEmail', email);
  await register.fill('#registerPassword', password);
  await register.check('#termsAccepted');
  await register.click('#registerForm button[type=submit]');
  await register.waitForURL((url) => url.pathname === '/verify.html', { timeout: 15000 });
  const openDashboard = register.getByRole('link', { name: 'Open dashboard' });
  if (await openDashboard.count()) await openDashboard.click();
  else await register.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
  await register.waitForURL((url) => url.pathname === '/dashboard.html', { timeout: 15000 });
  const storageState = await context.storageState();
  await register.close();
  await context.close();

  for (const viewport of viewports) {
    const sized = await browser.newContext({ viewport, storageState });
    for (const path of appPages) report.authenticated.push(await auditPage(sized, path, viewport.width, { expectAuth: true }));
    await sized.close();
  }

  report.assertions.push('premium theme and media layer loaded on all sampled public and authenticated pages');
  report.assertions.push('no sampled document-level horizontal overflow at 1440/390/360');
  report.assertions.push('no sampled visible [hidden] controls');
  report.assertions.push('no sampled same-origin 5xx responses or console errors');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
