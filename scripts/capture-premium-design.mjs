import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3311';
const out = path.resolve('audit-artifacts/premium-redesign');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function shot(context, route, name) {
  const page = await context.newPage();
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  await page.close();
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await shot(desktop, '/', 'home-desktop.png');
  await shot(desktop, '/pricing.html', 'pricing-desktop.png');
  await shot(desktop, '/trust.html', 'trust-desktop.png');
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await shot(mobile, '/', 'home-mobile.png');
  await shot(mobile, '/pricing.html', 'pricing-mobile.png');
  await mobile.close();

  const auth = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await auth.newPage();
  const email = `preview-${Date.now()}@example.test`;
  const password = 'Premium-Visual-Validation-42!';
  await page.goto(`${base}/auth.html?mode=register`, { waitUntil: 'networkidle' });
  await page.fill('#registerEmail', email);
  await page.fill('#registerPassword', password);
  await page.check('#termsAccepted');
  await page.click('#registerForm button[type=submit]');
  await page.waitForURL((url) => url.pathname === '/verify.html');
  const openDashboard = page.getByRole('link', { name: 'Open dashboard' });
  if (await openDashboard.count()) await openDashboard.click();
  else await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === '/dashboard.html');
  await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
  await page.goto(`${base}/control-intelligence.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, 'control-intelligence-desktop.png'), fullPage: true });
  await auth.close();
} finally {
  await browser.close();
}
