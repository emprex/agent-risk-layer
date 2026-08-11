import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'https://agentrisklayer.com';
const pages = ['/', '/demo.html', '/pricing.html', '/trust.html', '/help.html', '/assessment.html', '/auth.html', '/sample-report.html', '/methodology.html', '/quickstart.html', '/company.html', '/status.html'];
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 360, height: 800 }];
const browser = await chromium.launch({ headless: true });
const result = { generatedAt: new Date().toISOString(), base, api: {}, pages: [], auth: {} };

try {
  const request = await browser.newContext();
  for (const endpoint of ['/api/health', '/api/ready', '/api/config']) {
    const response = await request.request.get(`${base}${endpoint}`, { timeout: 30000 });
    result.api[endpoint] = response.status();
    assert.equal(response.status(), 200, `${endpoint} must return 200`);
  }
  const me = await request.request.get(`${base}/api/auth/me`, { timeout: 30000 });
  const meBody = await me.json();
  result.auth.me = { status: me.status(), user: meBody.user ?? null };
  assert.equal(me.status(), 200);
  assert.equal(meBody.user, null, 'anonymous auth/me must not expose a user');
  const dashboardApi = await request.request.get(`${base}/api/dashboard`, { timeout: 30000 });
  const dashboardText = await dashboardApi.text();
  result.auth.dashboardApi = { status: dashboardApi.status(), body: dashboardText.slice(0, 200) };
  assert.equal(dashboardApi.status(), 401, 'anonymous dashboard API must reject access');
  await request.close();

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    for (const route of pages) {
      const page = await context.newPage();
      const consoleErrors = [];
      const sameOrigin5xx = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin === new URL(base).origin && response.status() >= 500) sameOrigin5xx.push(`${response.status()} ${url.pathname}`);
      });
      const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
      assert.equal(response?.status(), 200, `${route} HTTP status at ${viewport.width}`);
      const state = await page.evaluate(() => ({
        path: location.pathname,
        viewport: innerWidth,
        htmlWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        premiumTheme: Boolean(document.querySelector('link[data-arl-premium-theme]')),
        premiumMedia: Boolean(document.querySelector('link[data-arl-premium-media]')),
        brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
        bodyBackground: getComputedStyle(document.body).backgroundImage,
        hiddenViolations: [...document.querySelectorAll('[hidden]')].filter((el) => getComputedStyle(el).display !== 'none').length,
      }));
      assert.equal(state.premiumTheme, true, `${route} premium theme missing at ${viewport.width}`);
      assert.equal(state.premiumMedia, true, `${route} premium media missing at ${viewport.width}`);
      assert.equal(state.brand.toLowerCase(), '#16b8ff', `${route} premium token missing at ${viewport.width}`);
      assert.match(state.bodyBackground, /radial-gradient|linear-gradient/i, `${route} premium background missing`);
      assert.ok(state.htmlWidth <= state.viewport + 1, `${route} html overflow ${state.htmlWidth}/${state.viewport}`);
      assert.ok(state.bodyWidth <= state.viewport + 1, `${route} body overflow ${state.bodyWidth}/${state.viewport}`);
      assert.equal(state.hiddenViolations, 0, `${route} exposes [hidden] content`);
      assert.deepEqual(consoleErrors, [], `${route} console errors: ${consoleErrors.join(' | ')}`);
      assert.deepEqual(sameOrigin5xx, [], `${route} same-origin 5xx: ${sameOrigin5xx.join(' | ')}`);
      result.pages.push({ route, width: viewport.width, ...state });
      await page.close();
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const dashboard = await context.newPage();
  await dashboard.goto(`${base}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dashboard.waitForURL((url) => url.pathname === '/auth.html', { timeout: 15000 });
  const destination = new URL(dashboard.url());
  result.auth.dashboardPage = { path: destination.pathname, next: destination.searchParams.get('next') };
  assert.equal(destination.pathname, '/auth.html');
  assert.equal(destination.searchParams.get('next'), '/dashboard.html');
  await dashboard.close();
  await context.close();

  console.log(JSON.stringify({
    summary: {
      api: result.api,
      pageChecks: result.pages.length,
      widths: [...new Set(result.pages.map((row) => row.width))],
      allPremiumTheme: result.pages.every((row) => row.premiumTheme && row.premiumMedia && row.brand.toLowerCase() === '#16b8ff'),
      allContained: result.pages.every((row) => row.htmlWidth <= row.viewport + 1 && row.bodyWidth <= row.viewport + 1),
      auth: result.auth,
    },
    generatedAt: result.generatedAt,
  }, null, 2));
} finally {
  await browser.close();
}
