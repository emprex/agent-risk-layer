import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.AUDIT_BASE_URL || 'https://agentrisklayer.com').replace(/\/$/, '');
const outDir = path.resolve(process.env.AUDIT_OUT_DIR || 'audit-artifacts/public-production-ux');
await fs.mkdir(outDir, { recursive: true });

const pages = [
  { key: 'demo', path: '/demo.html' },
  { key: 'trust', path: '/trust.html' },
];

const browser = await chromium.launch({ headless: true });
const results = { generatedAt: new Date().toISOString(), baseUrl, pages: [] };

function unique(items) {
  return [...new Set(items)];
}

async function layoutState(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: typeof element.className === 'string' ? element.className : '',
          text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          minWidth: style.minWidth,
          position: style.position,
          display: style.display,
          visibility: style.visibility,
        };
      })
      .filter((item) => item.display !== 'none' && item.visibility !== 'hidden' && item.width > 0 && (item.right > width + 1 || item.left < -1))
      .sort((a, b) => Math.max(b.right - width, -b.left) - Math.max(a.right - width, -a.left))
      .slice(0, 20);
    return {
      innerWidth: width,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflow: document.documentElement.scrollWidth > width + 1,
      offenders,
    };
  });
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const spec of pages) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const response = await page.goto(`${baseUrl}${spec.path}`, { waitUntil: 'networkidle', timeout: 45000 });
    const closed = await layoutState(page);
    const closedShot = path.join(outDir, `${spec.key}-mobile-closed.png`);
    await page.screenshot({ path: closedShot, fullPage: true });

    const menu = page.locator('[data-menu-toggle]');
    if (await menu.count()) {
      await menu.click();
      await page.waitForTimeout(200);
    }
    const open = await layoutState(page);
    const openShot = path.join(outDir, `${spec.key}-mobile-open.png`);
    await page.screenshot({ path: openShot, fullPage: true });

    results.pages.push({ key: spec.key, path: spec.path, status: response?.status() ?? null, closed, open, consoleErrors: unique(consoleErrors) });
    await page.close();
  }
  await context.close();
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outDir, 'overflow-diagnosis.json'), JSON.stringify(results, null, 2));
const lines = ['# Mobile overflow diagnosis', '', `Generated: ${results.generatedAt}`, `Base URL: ${baseUrl}`, ''];
for (const page of results.pages) {
  lines.push(`## ${page.key}`);
  lines.push(`- menu closed: overflow=${page.closed.overflow}; html=${page.closed.htmlScrollWidth}; body=${page.closed.bodyScrollWidth}; viewport=${page.closed.innerWidth}`);
  lines.push(`- menu open: overflow=${page.open.overflow}; html=${page.open.htmlScrollWidth}; body=${page.open.bodyScrollWidth}; viewport=${page.open.innerWidth}`);
  lines.push('- closed offenders:');
  lines.push(...(page.closed.offenders.length ? page.closed.offenders.map((item) => `  - ${item.tag}${item.id ? `#${item.id}` : ''}${item.className ? `.${item.className.split(/\s+/).join('.')}` : ''}: left=${item.left}, right=${item.right}, width=${item.width}, min-width=${item.minWidth}, text=${JSON.stringify(item.text)}`) : ['  - none']));
  lines.push('- open offenders:');
  lines.push(...(page.open.offenders.length ? page.open.offenders.map((item) => `  - ${item.tag}${item.id ? `#${item.id}` : ''}${item.className ? `.${item.className.split(/\s+/).join('.')}` : ''}: left=${item.left}, right=${item.right}, width=${item.width}, min-width=${item.minWidth}, text=${JSON.stringify(item.text)}`) : ['  - none']));
  lines.push('');
}
const summary = lines.join('\n');
await fs.writeFile(path.join(outDir, 'summary.md'), summary);
console.log(summary);
