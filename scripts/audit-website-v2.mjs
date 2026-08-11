import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4173';
const publicPages = ['/', '/trust.html', '/demo.html', '/methodology.html', '/help.html', '/company.html', '/sample-report.html'];
const widths = [1440, 1024, 768, 390, 360, 320];
await mkdir('test-artifacts/website-v2', { recursive: true });

async function revealFullPage(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = page.viewportSize()?.height || 900;
  for (let y = 0; y < height; y += Math.max(420, Math.floor(viewport * 0.72))) {
    await page.evaluate((nextY) => window.scrollTo({ top: nextY, behavior: 'instant' }), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(180);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(220);
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width <= 768 ? 900 : 1000 } });
    const page = await context.newPage();
    for (const path of publicPages) {
      const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200, `${path} should return 200 at ${width}px`);
      await page.waitForFunction(() => document.documentElement.dataset.websiteV2 === 'ready');
      const state = await page.evaluate(() => ({
        path: location.pathname,
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
        background: getComputedStyle(document.body).backgroundColor,
      }));
      assert.equal(state.shell, 'public', `${path} should remain a public shell`);
      assert.equal(state.css, true, `${path} should load Website v2 CSS`);
      assert.equal(state.oldPremium, false, `${path} should not load the intermediate premium skin`);
      assert.ok(state.scrollWidth <= state.clientWidth + 1, `${path} overflows at ${width}px: ${state.scrollWidth}/${state.clientWidth}`);
      assert.equal(state.visibleHidden, 0, `${path} exposes [hidden] content at ${width}px`);
      if (path === '/') {
        assert.equal(await page.locator('[data-authority-demo]').count(), 1);
        assert.equal(await page.locator('[data-evidence-chain]').count(), 1);
        assert.equal(await page.getByText('Security evidence, not security theatre.').count(), 1);
        if ([1440, 390].includes(width)) {
          await revealFullPage(page);
          const unrevealed = await page.locator('[data-reveal]:not(.is-visible)').count();
          assert.equal(unrevealed, 0, `homepage reveal content should be visible before screenshot at ${width}px`);
          await page.screenshot({ path: `test-artifacts/website-v2/home-${width}.png`, fullPage: true });
        }
      }
      results.push({ width, ...state });
    }
    await context.close();
  }

  const reduced = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  const page = await reduced.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.websiteV2 === 'ready');
  const reducedState = await page.evaluate(() => ({
    hiddenReveal: [...document.querySelectorAll('[data-reveal]')].filter((el) => getComputedStyle(el).opacity === '0').length,
    scene: document.querySelector('[data-authority-demo]')?.dataset.scene,
  }));
  assert.equal(reducedState.hiddenReveal, 0, 'reduced motion should reveal content immediately');
  assert.equal(reducedState.scene, '3', 'reduced motion should show a stable completed authority scene');
  await reduced.close();

  console.log(JSON.stringify({ pageChecks: results.length, widths, publicPages, reducedMotion: reducedState }, null, 2));
} finally {
  await browser.close();
}
