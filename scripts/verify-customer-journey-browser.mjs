import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3311').replace(/\/$/, '');
const outDir = path.resolve(process.env.AUDIT_OUT_DIR || 'audit-artifacts/customer-journey');
await fs.mkdir(outDir, { recursive: true });

const email = `visible-customer-${Date.now()}@example.test`;
const password = 'Visible-Customer-Journey-42!';
const agentName = `Visible customer agent ${Date.now()}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const sameOriginErrors = [];
const consoleErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('response', (response) => {
  try {
    const url = new URL(response.url());
    if (url.origin === new URL(baseUrl).origin && response.status() >= 400) {
      sameOriginErrors.push({ status: response.status(), url: url.pathname });
    }
  } catch {}
});

const waitSettled = async () => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(150);
};

const noOverflow = async () => page.evaluate(() => ({
  viewport: window.innerWidth,
  html: document.documentElement.scrollWidth,
  body: document.body.scrollWidth,
}));

const evidence = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  account: {},
  assessment: {},
  checkout: {},
  report: {},
  dashboard: {},
  mobile: {},
  privacy: {},
};

try {
  await page.goto(`${baseUrl}/auth.html?mode=register`, { waitUntil: 'networkidle' });
  await page.locator('#registerEmail').fill(email);
  await page.locator('#registerPassword').fill(password);
  await page.locator('#termsAccepted').check();
  await page.locator('#registerForm button[type="submit"]').click();
  await page.waitForURL(/\/verify\.html\?token=/);
  await page.getByText('Email verified.').waitFor();
  evidence.account.registeredAndVerified = true;

  await page.locator('a[href="/dashboard.html"]').first().click();
  await page.waitForURL(/\/dashboard\.html$/);
  await page.locator('#logout').waitFor();
  await page.screenshot({ path: path.join(outDir, '01-dashboard-after-registration.png'), fullPage: true });

  await page.locator('#logout').click();
  await page.waitForURL(`${baseUrl}/`);
  await page.goto(`${baseUrl}/auth.html`, { waitUntil: 'networkidle' });
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.waitForURL(/\/dashboard\.html$/);
  await page.locator('#logout').waitFor();
  evidence.account.signInAfterLogout = true;

  await page.goto(`${baseUrl}/assessment.html`, { waitUntil: 'networkidle' });
  await page.locator('#agentName').fill(agentName);
  await page.locator('#agentType').selectOption({ label: 'Customer support agent' });
  await page.locator('#agentDescription').fill('Synthetic customer-support agent used only for the disposable local customer-journey audit.');
  assert.equal(await page.locator('#backButton').isVisible(), false);
  assert.equal(await page.locator('#submitAssessment').isVisible(), false);
  await page.locator('#nextButton').click();

  let answered = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    await page.locator('#questionStage').waitFor({ state: 'visible' });
    const radios = page.locator('input[name="currentQuestion"]');
    assert.ok(await radios.count() > 0, 'Each assessment step should render at least one answer');
    await radios.first().locator('xpath=ancestor::label[1]').click();
    answered += 1;
    if (await page.locator('#submitAssessment').isVisible()) {
      await page.locator('#submitAssessment').click();
      break;
    }
    await page.locator('#nextButton').click();
  }
  assert.ok(answered > 0, 'Assessment should contain security questions');
  await page.waitForURL(/\/result\.html\?id=.*&token=/);
  await page.locator('#resultRoot .plain-result-main').waitFor();
  const resultUrl = page.url();
  const resultText = await page.locator('#resultRoot').innerText();
  assert.match(resultText, /unverified/i);
  assert.match(resultText, /Your next action/i);
  evidence.assessment = {
    answeredQuestions: answered,
    resultUrlPath: new URL(resultUrl).pathname,
    unverifiedBoundaryVisible: /unverified/i.test(resultText),
  };
  await page.screenshot({ path: path.join(outDir, '02-free-assessment-result.png'), fullPage: true });

  await page.locator('#buyPro').waitFor();
  await page.locator('#buyPro').click();
  await page.waitForURL(/\/success\.html\?session_id=/);
  await page.getByText('Your access is ready.').waitFor();
  const successText = await page.locator('#successRoot').innerText();
  assert.match(successText, /Payment and fulfilment completed/i);
  assert.match(successText, /report has been generated and email delivery has been attempted/i);
  evidence.checkout = {
    demoPaymentAndFulfilmentVisible: true,
    successPath: new URL(page.url()).pathname,
  };
  await page.screenshot({ path: path.join(outDir, '03-demo-checkout-success.png'), fullPage: true });

  await page.locator('a[href="/dashboard.html"]').first().click();
  await page.waitForURL(/\/dashboard\.html$/);
  await page.getByText(agentName, { exact: false }).first().waitFor();
  evidence.dashboard.assessmentVisibleAfterFulfilment = true;
  await page.screenshot({ path: path.join(outDir, '04-dashboard-after-fulfilment.png'), fullPage: true });

  await page.goto(resultUrl, { waitUntil: 'networkidle' });
  const pdfLink = page.locator('a[href*="/api/reports/"][href*="/pdf"]');
  await pdfLink.waitFor();
  evidence.report.paidPdfLinkVisible = true;
  const pdfHref = await pdfLink.getAttribute('href');
  assert.ok(pdfHref, 'Paid result should expose the PDF report link');
  const pdfResponse = await page.goto(new URL(pdfHref, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  assert.equal(pdfResponse?.status(), 200);
  assert.match(String(pdfResponse?.headers()['content-type'] || ''), /application\/pdf/i);
  evidence.report.pdfHttp200 = true;
  evidence.report.pdfContentType = pdfResponse?.headers()['content-type'] || '';

  await page.goto(resultUrl, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileResult = await noOverflow();
  evidence.mobile.result390 = mobileResult;
  assert.ok(mobileResult.html <= mobileResult.viewport + 1, `Result page overflow: ${JSON.stringify(mobileResult)}`);
  assert.ok(mobileResult.body <= mobileResult.viewport + 1, `Result body overflow: ${JSON.stringify(mobileResult)}`);
  await page.screenshot({ path: path.join(outDir, '05-paid-result-mobile-390.png'), fullPage: true });

  await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'networkidle' });
  const mobileDashboard = await noOverflow();
  evidence.mobile.dashboard390 = mobileDashboard;
  assert.ok(mobileDashboard.html <= mobileDashboard.viewport + 1, `Dashboard overflow: ${JSON.stringify(mobileDashboard)}`);
  assert.ok(mobileDashboard.body <= mobileDashboard.viewport + 1, `Dashboard body overflow: ${JSON.stringify(mobileDashboard)}`);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'networkidle' });
  await page.locator('#logout').click();
  await page.waitForURL(`${baseUrl}/`);
  const errorsBeforePrivacyCheck = sameOriginErrors.length;
  await page.goto(resultUrl, { waitUntil: 'networkidle' });
  await waitSettled();
  const privateText = await page.locator('body').innerText();
  assert.doesNotMatch(privateText, new RegExp(agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(page.url().includes('/auth.html') || /sign in/i.test(privateText), 'Private result should require authentication after logout');
  evidence.privacy.privateAfterLogout = true;

  const unexpectedErrors = sameOriginErrors.slice(0, errorsBeforePrivacyCheck);
  assert.deepEqual(unexpectedErrors, [], `Unexpected same-origin HTTP errors before logout privacy check: ${JSON.stringify(unexpectedErrors)}`);
  assert.deepEqual(consoleErrors, [], `Unexpected console errors: ${JSON.stringify(consoleErrors)}`);

  await fs.writeFile(path.join(outDir, 'customer-journey.json'), JSON.stringify(evidence, null, 2));
  await fs.writeFile(path.join(outDir, 'summary.md'), [
    '# Disposable visible customer journey audit',
    '',
    `Generated: ${evidence.generatedAt}`,
    `Base URL: ${baseUrl}`,
    `Registered and verified: ${evidence.account.registeredAndVerified}`,
    `Signed in after logout: ${evidence.account.signInAfterLogout}`,
    `Assessment questions answered through visible UI: ${evidence.assessment.answeredQuestions}`,
    `Unverified evidence boundary visible: ${evidence.assessment.unverifiedBoundaryVisible}`,
    `Demo checkout and fulfilment screen reached: ${evidence.checkout.demoPaymentAndFulfilmentVisible}`,
    `Assessment visible on dashboard after fulfilment: ${evidence.dashboard.assessmentVisibleAfterFulfilment}`,
    `Paid PDF report returned HTTP 200/application-pdf: ${evidence.report.pdfHttp200}`,
    `390px result width: ${JSON.stringify(evidence.mobile.result390)}`,
    `390px dashboard width: ${JSON.stringify(evidence.mobile.dashboard390)}`,
    `Private after logout: ${evidence.privacy.privateAfterLogout}`,
    '',
    'This audit uses a disposable local SQLite database and DEMO_MODE=true. It does not exercise live Stripe, live Resend email, production PostgreSQL, or a production authenticated account.',
    '',
  ].join('\n'));
  console.log(JSON.stringify(evidence));
} finally {
  await context.close();
  await browser.close();
}
