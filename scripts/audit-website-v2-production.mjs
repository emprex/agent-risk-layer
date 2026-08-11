import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'https://agentrisklayer.com';
const pages = [
  ['/', 'public'],
  ['/pricing.html', 'public'],
  ['/trust.html', 'public'],
  ['/demo.html', 'public'],
  ['/methodology.html', 'public'],
  ['/help.html', 'public'],
  ['/assessment.html', 'app'],
  ['/company.html', 'public'],
  ['/sample-report.html', 'public'],
];
const widths = [1440, 390, 360, 320];
await mkdir('test-artifacts/website-v2-production', { recursive: true });

async function revealFullPage(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = page.viewportSize()?.height || 900;
  for (let y = 0; y < height; y += Math.max(420, Math.floor(viewport * 0.72))) {
    await page.evaluate((nextY) => window.scrollTo({ top: nextY, behavior: 'instant' }), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(160);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(220);
}

const api = {};
for (const path of ['/api/health', '/api/ready', '/api/config']) {
  const response = await fetch(`${base}${path}`);
  api[path] = response.status;
  assert.equal(response.status, 200, `${path} should be healthy in production`);
}
const meResponse = await fetch(`${base}/api/auth/me`);
api['/api/auth/me'] = meResponse.status;
assert.equal(meResponse.status, 200, '/api/auth/me should answer anonymously');
const me = await meResponse.json();
assert.equal(me.user, null, 'anonymous auth state should not expose a user');
const dashboardApi = await fetch(`${base}/api/dashboard`);
api['/api/dashboard'] = dashboardApi.status;
assert.equal(dashboardApi.status, 401, 'anonymous dashboard API should require sign-in');

const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 900 : 1000 } });
    const page = await context.newPage();
    for (const [path, expectedShell] of pages) {
      const consoleErrors = [];
      const serverErrors = [];
      const onConsole = (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); };
      const onResponse = (response) => {
        try {
          const url = new URL(response.url());
          if (url.origin === base && response.status() >= 500) serverErrors.push(`${response.status()} ${url.pathname}`);
        } catch {}
      };
      page.on('console', onConsole);
      page.on('response', onResponse);
      const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200, `${path} should return 200 at ${width}px`);
      await page.waitForFunction(() => document.documentElement.dataset.websiteV2 === 'ready');
      const state = await page.evaluate(() => ({
        pathname: location.pathname,
        shell: document.body.dataset.shell,
        css: Boolean(document.querySelector('link[href="/website-v2.css"]')),
        oldPremium: Boolean(document.querySelector('link[href="/premium-theme.css"],link[href="/premium-media.css"]')),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        visibleHidden: [...document.querySelectorAll('[hidden]')].filter((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return style.display !== 'none' && box.width > 0 && box.height > 0;
        }).length,
      }));
      assert.equal(state.shell, expectedShell, `${path} should remain ${expectedShell} shell`);
      assert.equal(state.css, true, `${path} should load Website v2 CSS`);
      assert.equal(state.oldPremium, false, `${path} should not load the intermediate premium skin`);
      assert.ok(state.scrollWidth <= state.clientWidth + 1, `${path} overflows at ${width}px: ${state.scrollWidth}/${state.clientWidth}`);
      assert.equal(state.visibleHidden, 0, `${path} exposes [hidden] content at ${width}px`);
      assert.equal(serverErrors.length, 0, `${path} produced same-origin 5xx responses: ${serverErrors.join(', ')}`);
      assert.equal(consoleErrors.length, 0, `${path} produced console errors: ${consoleErrors.join(' | ')}`);
      if (path === '/') {
        assert.equal(await page.locator('[data-authority-demo]').count(), 1, 'home should contain authority demo');
        assert.equal(await page.locator('[data-evidence-chain]').count(), 1, 'home should contain evidence chain');
        assert.equal(await page.getByText('Security evidence, not security theatre.').count(), 1, 'home should contain trust boundary');
        if ([1440, 390].includes(width)) {
          await revealFullPage(page);
          assert.equal(await page.locator('[data-reveal]:not(.is-visible)').count(), 0, 'revealed homepage content should be visible');
          await page.screenshot({ path: `test-artifacts/website-v2-production/home-${width}.png`, fullPage: true });
        }
      }
      checks.push({ width, path, ...state });
      page.off('console', onConsole);
      page.off('response', onResponse);
    }
    await context.close();
  }

  const authContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const authPage = await authContext.newPage();
  await authPage.goto(`${base}/dashboard.html`, { waitUntil: 'networkidle' });
  assert.equal(authPage.url().includes('/auth.html'), true, 'anonymous dashboard should redirect to auth');
  const next = new URL(authPage.url()).searchParams.get('next');
  assert.equal(next, '/dashboard.html', 'dashboard redirect should preserve destination');
  await authContext.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  await reducedPage.waitForFunction(() => document.documentElement.dataset.websiteV2 === 'ready');
  const reducedState = await reducedPage.evaluate(() => ({
    hiddenReveal: [...document.querySelectorAll('[data-reveal]')].filter((el) => getComputedStyle(el).opacity === '0').length,
    scene: document.querySelector('[data-authority-demo]')?.dataset.scene,
  }));
  assert.equal(reducedState.hiddenReveal, 0, 'reduced motion should reveal all content');
  assert.equal(reducedState.scene, '3', 'reduced motion should use stable completed authority state');
  await reduced.close();

  console.log(JSON.stringify({ api, pageChecks: checks.length, widths, pages, reducedMotion: reducedState, anonymousDashboardRedirect: true }, null, 2));
} finally {
  await browser.close();
}
