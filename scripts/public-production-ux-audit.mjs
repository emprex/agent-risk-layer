import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.AUDIT_BASE_URL || 'https://agentrisklayer.com').replace(/\/$/, '');
const outDir = path.resolve(process.env.AUDIT_OUT_DIR || 'audit-artifacts/public-production-ux');
await fs.mkdir(outDir, { recursive: true });

const pages = [
  { key: 'home', path: '/' },
  { key: 'demo', path: '/demo.html' },
  { key: 'pricing', path: '/pricing.html' },
  { key: 'assessment', path: '/assessment.html' },
  { key: 'auth', path: '/auth.html' },
  { key: 'trust', path: '/trust.html' },
  { key: 'help', path: '/help.html' },
  { key: 'sample-report', path: '/sample-report.html' },
  { key: 'security-center', path: '/security-center.html' },
  { key: 'company', path: '/company.html' },
  { key: 'quickstart', path: '/quickstart.html' },
];

const viewports = [
  { key: 'desktop', width: 1440, height: 1000 },
  { key: 'mobile', width: 390, height: 844 },
];

function safeName(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function uniq(values) {
  return [...new Set(values)];
}

const browser = await chromium.launch({ headless: true });
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  api: {},
  pages: [],
  links: [],
};

try {
  const apiContext = await browser.newContext({ ignoreHTTPSErrors: false });
  for (const endpoint of ['/api/health', '/api/ready', '/api/config']) {
    try {
      const response = await apiContext.request.get(`${baseUrl}${endpoint}`, { timeout: 30000 });
      const text = await response.text();
      let body = text;
      try { body = JSON.parse(text); } catch {}
      results.api[endpoint] = { status: response.status(), ok: response.ok(), body };
    } catch (error) {
      results.api[endpoint] = { error: error.message };
    }
  }
  await apiContext.close();

  const discoveredLinks = new Set();

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });

    for (const spec of pages) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const badResponses = [];

      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' }));
      page.on('response', (response) => {
        if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
          badResponses.push({ url: response.url(), status: response.status() });
        }
      });

      let navigationStatus = null;
      let navigationError = null;
      try {
        const response = await page.goto(`${baseUrl}${spec.path}`, { waitUntil: 'networkidle', timeout: 45000 });
        navigationStatus = response?.status() ?? null;
      } catch (error) {
        navigationError = error.message;
      }

      if (!navigationError) {
        if (spec.key === 'pricing') {
          await page.locator('#pricingGrid').waitFor({ state: 'visible', timeout: 15000 }).catch(() => null);
          await page.waitForTimeout(1200);
        }
        if (spec.key === 'auth' && viewport.key === 'desktop') {
          await page.locator('[data-tab="register"]').click().catch(() => null);
          await page.waitForTimeout(200);
        }
        if (spec.key === 'demo' && viewport.key === 'desktop') {
          await page.locator('#nextStep').click().catch(() => null);
          await page.waitForTimeout(250);
        }
        if (viewport.key === 'mobile') {
          const menu = page.locator('[data-menu-toggle]');
          if (await menu.count()) {
            await menu.click().catch(() => null);
            await page.waitForTimeout(150);
          }
        }
      }

      const state = navigationError ? {} : await page.evaluate(() => {
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const textOf = (element) => String(element?.textContent || '').replace(/\s+/g, ' ').trim();
        const main = document.querySelector('main');
        const h1s = [...document.querySelectorAll('h1')].filter(visible).map(textOf);
        const ctas = [...document.querySelectorAll('a.button, button.button')]
          .filter(visible)
          .slice(0, 30)
          .map((element) => ({ text: textOf(element), href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null }));
        const nav = [...document.querySelectorAll('[data-primary-navigation] a, [data-primary-navigation] button')]
          .filter(visible)
          .map((element) => textOf(element));
        const internalLinks = [...document.querySelectorAll('a[href]')]
          .map((anchor) => anchor.href)
          .filter((href) => href.startsWith(location.origin));
        return {
          title: document.title,
          h1s,
          mainTextLength: textOf(main).length,
          ctas,
          nav,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          menuExpanded: document.querySelector('[data-menu-toggle]')?.getAttribute('aria-expanded') || null,
          pricingCards: document.querySelectorAll('.pricing-card-v10').length,
          pricingError: textOf(document.querySelector('#pricingError')),
          assessmentFormVisible: visible(document.querySelector('#assessmentForm')),
          authRegisterVisible: visible(document.querySelector('#registerForm')),
          internalLinks,
        };
      }).catch((error) => ({ evaluateError: error.message }));

      for (const href of state.internalLinks || []) {
        const url = new URL(href);
        url.hash = '';
        if (url.pathname.startsWith('/api/')) continue;
        if (/\.(?:png|jpg|jpeg|svg|webp|pdf|json|mjs|css|js)$/i.test(url.pathname)) continue;
        discoveredLinks.add(url.toString());
      }

      const screenshot = path.join(outDir, `${safeName(spec.key)}-${viewport.key}.png`);
      if (!navigationError) {
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
      }

      results.pages.push({
        key: spec.key,
        path: spec.path,
        viewport,
        navigationStatus,
        navigationError,
        finalUrl: page.url(),
        ...state,
        consoleErrors: uniq(consoleErrors),
        pageErrors: uniq(pageErrors),
        failedRequests,
        badResponses,
        screenshot: path.relative(process.cwd(), screenshot),
      });
      await page.close();
    }
    await context.close();
  }

  const linkContext = await browser.newContext();
  for (const href of [...discoveredLinks].sort().slice(0, 100)) {
    try {
      const response = await linkContext.request.get(href, { timeout: 30000, maxRedirects: 5 });
      results.links.push({ href, status: response.status(), ok: response.ok() || [301, 302, 303, 307, 308].includes(response.status()) });
    } catch (error) {
      results.links.push({ href, error: error.message, ok: false });
    }
  }
  await linkContext.close();
} finally {
  await browser.close();
}

const problems = [];
for (const page of results.pages) {
  if (page.navigationError || (page.navigationStatus && page.navigationStatus >= 400)) problems.push(`${page.key}/${page.viewport.key}: navigation failed (${page.navigationError || page.navigationStatus})`);
  if (page.overflow) problems.push(`${page.key}/${page.viewport.key}: horizontal overflow ${page.scrollWidth}px > ${page.innerWidth}px`);
  if (page.consoleErrors?.length) problems.push(`${page.key}/${page.viewport.key}: ${page.consoleErrors.length} console error(s)`);
  if (page.pageErrors?.length) problems.push(`${page.key}/${page.viewport.key}: ${page.pageErrors.length} page error(s)`);
  if (page.badResponses?.length) problems.push(`${page.key}/${page.viewport.key}: ${page.badResponses.length} same-origin HTTP error response(s)`);
  if (!page.h1s?.length) problems.push(`${page.key}/${page.viewport.key}: no visible H1`);
  if (page.key === 'pricing' && page.pricingCards < 6) problems.push(`${page.key}/${page.viewport.key}: expected pricing cards did not fully load (${page.pricingCards || 0})`);
  if (page.key === 'pricing' && page.pricingError) problems.push(`${page.key}/${page.viewport.key}: pricing error visible: ${page.pricingError}`);
  if (page.key === 'assessment' && !page.assessmentFormVisible) problems.push(`${page.key}/${page.viewport.key}: assessment form not visible`);
  if (page.key === 'auth' && page.viewport.key === 'desktop' && !page.authRegisterVisible) problems.push(`${page.key}/${page.viewport.key}: registration tab did not become visible`);
}
for (const link of results.links) {
  if (!link.ok) problems.push(`link: ${link.href} -> ${link.status || link.error}`);
}

results.problems = uniq(problems);
await fs.writeFile(path.join(outDir, 'audit.json'), JSON.stringify(results, null, 2));

const summary = [
  '# AgentRiskLayer public production UX audit',
  '',
  `Generated: ${results.generatedAt}`,
  `Base URL: ${baseUrl}`,
  '',
  '## Production endpoints',
  ...Object.entries(results.api).map(([endpoint, value]) => `- ${endpoint}: ${value.status ?? 'error'}${value.ok === false ? ' (not ok)' : ''}${value.error ? ` — ${value.error}` : ''}`),
  '',
  '## Page checks',
  ...results.pages.map((page) => `- ${page.key} / ${page.viewport.key}: HTTP ${page.navigationStatus ?? 'error'}; H1=${JSON.stringify(page.h1s || [])}; overflow=${Boolean(page.overflow)}; consoleErrors=${page.consoleErrors?.length || 0}; badResponses=${page.badResponses?.length || 0}`),
  '',
  '## Detected problems',
  ...(results.problems.length ? results.problems.map((problem) => `- ${problem}`) : ['- None detected by the automated public audit.']),
  '',
  'This audit is public, read-only and unauthenticated. It does not prove private customer workflows, tenant isolation, payment completion, webhook delivery, email delivery, or authenticated remediation/retest behaviour.',
  '',
].join('\n');
await fs.writeFile(path.join(outDir, 'summary.md'), summary);
console.log(summary);
