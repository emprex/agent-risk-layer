import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = String(process.env.AUDIT_BASE_URL || 'https://agentrisklayer.com').replace(/\/$/, '');
const outDir = path.resolve(process.env.AUDIT_OUT_DIR || 'audit-artifacts/public-production-ux');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = { generatedAt: new Date().toISOString(), baseUrl, api: {}, assessment: {}, help: {}, authBoundary: {}, mobile: {} };

try {
  const requestContext = await browser.newContext();
  for (const endpoint of ['/api/health', '/api/ready', '/api/config']) {
    const response = await requestContext.request.get(`${baseUrl}${endpoint}`, { timeout: 30000 });
    const text = await response.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    results.api[endpoint] = { status: response.status(), ok: response.ok(), body };
    assert.equal(response.status(), 200, `${endpoint} should return 200`);
  }

  const meResponse = await requestContext.request.get(`${baseUrl}/api/auth/me`, { timeout: 30000 });
  const meBody = await meResponse.json();
  results.authBoundary.me = { status: meResponse.status(), body: meBody };
  assert.equal(meResponse.status(), 200, '/api/auth/me should be readable anonymously');
  assert.equal(meBody.user, null, 'anonymous /api/auth/me must not expose a user');

  const dashboardApi = await requestContext.request.get(`${baseUrl}/api/dashboard`, { timeout: 30000 });
  let dashboardBody = await dashboardApi.text();
  try { dashboardBody = JSON.parse(dashboardBody); } catch {}
  results.authBoundary.dashboardApi = { status: dashboardApi.status(), body: dashboardBody };
  assert.equal(dashboardApi.status(), 401, 'anonymous /api/dashboard must reject access');
  assert.match(String(dashboardBody?.error || dashboardBody), /sign in/i, 'anonymous dashboard API should require sign-in');
  await requestContext.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const assessment = await desktop.newPage();
  const response = await assessment.goto(`${baseUrl}/assessment.html`, { waitUntil: 'networkidle', timeout: 45000 });
  assert.equal(response?.status(), 200);
  results.assessment.controls = {};
  for (const selector of ['#revisionReviewField', '#backButton', '#submitAssessment']) {
    const state = await assessment.locator(selector).evaluate((element) => ({
      hidden: element.hidden,
      display: getComputedStyle(element).display,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    results.assessment.controls[selector] = state;
    assert.equal(state.hidden, true, `${selector} hidden property`);
    assert.equal(state.display, 'none', `${selector} display`);
    assert.equal(state.width, 0, `${selector} width`);
    assert.equal(state.height, 0, `${selector} height`);
  }
  await assessment.screenshot({ path: path.join(outDir, 'assessment-postdeploy.png'), fullPage: true });
  await assessment.close();

  const help = await desktop.newPage();
  const helpResponse = await help.goto(`${baseUrl}/help.html`, { waitUntil: 'networkidle', timeout: 45000 });
  assert.equal(helpResponse?.status(), 200, 'help HTTP status');
  const helpText = await help.locator('main').innerText();
  results.help = {
    status: helpResponse?.status() ?? null,
    hasNoProofYet: helpText.includes('No proof yet'),
    hasCustomerAssertion: helpText.includes('My answer only (not verified)'),
    hasEvidenceReady: helpText.includes('I have supporting evidence to attach (not verified yet)'),
    hasVerificationBoundary: helpText.includes('Selecting an option in the assessment never creates verified evidence.'),
    hasOldOwnerStatement: helpText.includes('Owner statement'),
  };
  assert.equal(results.help.hasNoProofYet, true, 'Help should contain current no-proof label');
  assert.equal(results.help.hasCustomerAssertion, true, 'Help should contain current customer-assertion label');
  assert.equal(results.help.hasEvidenceReady, true, 'Help should contain current supporting-evidence label');
  assert.equal(results.help.hasVerificationBoundary, true, 'Help should state that a form option cannot create verified evidence');
  assert.equal(results.help.hasOldOwnerStatement, false, 'Help should not contain obsolete Owner statement terminology');
  await help.screenshot({ path: path.join(outDir, 'help-evidence-language-postdeploy.png'), fullPage: true });
  await help.close();

  const privatePage = await desktop.newPage();
  await privatePage.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await privatePage.waitForURL((url) => url.pathname === '/auth.html', { timeout: 15000 });
  const privateUrl = new URL(privatePage.url());
  results.authBoundary.dashboardPage = {
    finalPath: privateUrl.pathname,
    next: privateUrl.searchParams.get('next'),
    bodyText: (await privatePage.locator('body').innerText()).slice(0, 500),
  };
  assert.equal(privateUrl.pathname, '/auth.html', 'anonymous dashboard page should redirect to auth');
  assert.equal(privateUrl.searchParams.get('next'), '/dashboard.html', 'dashboard redirect should preserve the intended destination');
  assert.match(results.authBoundary.dashboardPage.bodyText, /Welcome to AgentRiskLayer|Secure account access/i, 'auth destination should render the sign-in surface');
  await privatePage.screenshot({ path: path.join(outDir, 'anonymous-dashboard-redirect.png'), fullPage: true });
  await privatePage.close();
  await desktop.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport });
    for (const key of ['demo', 'trust']) {
      const page = await context.newPage();
      const pageResponse = await page.goto(`${baseUrl}/${key}.html`, { waitUntil: 'networkidle', timeout: 45000 });
      assert.equal(pageResponse?.status(), 200, `${key} HTTP status`);
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      results.mobile[`${key}-${viewport.width}`] = dimensions;
      assert.ok(dimensions.html <= dimensions.viewport + 1, `${key} html overflow at ${viewport.width}: ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.body <= dimensions.viewport + 1, `${key} body overflow at ${viewport.width}: ${JSON.stringify(dimensions)}`);
      await page.screenshot({ path: path.join(outDir, `${key}-${viewport.width}-postdeploy.png`), fullPage: true });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outDir, 'postdeploy.json'), JSON.stringify(results, null, 2));
const summary = [
  '# Public production post-deploy verification',
  '',
  `Generated: ${results.generatedAt}`,
  `Base URL: ${baseUrl}`,
  ...Object.entries(results.api).map(([endpoint, value]) => `- ${endpoint}: HTTP ${value.status}`),
  `- assessment hidden controls: ${JSON.stringify(results.assessment.controls)}`,
  `- help evidence terminology: ${JSON.stringify(results.help)}`,
  `- anonymous auth boundary: ${JSON.stringify(results.authBoundary)}`,
  ...Object.entries(results.mobile).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`),
  '',
  'All assertions passed.',
  '',
].join('\n');
await fs.writeFile(path.join(outDir, 'summary.md'), summary);
console.log(summary);
