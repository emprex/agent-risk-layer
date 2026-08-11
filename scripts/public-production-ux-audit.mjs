import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.AUDIT_BASE_URL || 'https://agentrisklayer.com').replace(/\/$/, '');
const outDir = path.resolve(process.env.AUDIT_OUT_DIR || 'audit-artifacts/public-production-ux');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = { generatedAt: new Date().toISOString(), baseUrl, assessment: {}, layout: {} };

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  const assessmentResponse = await page.goto(`${baseUrl}/assessment.html`, { waitUntil: 'networkidle', timeout: 45000 });
  results.assessment.status = assessmentResponse?.status() ?? null;
  results.assessment.controls = await page.evaluate(() => {
    const inspect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        hiddenAttribute: element.hasAttribute('hidden'),
        hiddenProperty: Boolean(element.hidden),
        display: style.display,
        visibility: style.visibility,
        rect: { width: rect.width, height: rect.height, left: rect.left, top: rect.top },
        visibleGeometry: rect.width > 0 && rect.height > 0,
        text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    };
    return {
      back: inspect('#backButton'),
      next: inspect('#nextButton'),
      submit: inspect('#submitAssessment'),
      hiddenElementsVisible: [...document.querySelectorAll('[hidden]')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || '',
            className: typeof element.className === 'string' ? element.className : '',
            display: style.display,
            width: rect.width,
            height: rect.height,
            text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
          };
        })
        .filter((item) => item.display !== 'none' && item.width > 0 && item.height > 0),
    };
  });
  await page.screenshot({ path: path.join(outDir, 'assessment-hidden-controls.png'), fullPage: true });
  await page.close();
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const key of ['demo', 'trust']) {
    const mobilePage = await mobile.newPage();
    const response = await mobilePage.goto(`${baseUrl}/${key}.html`, { waitUntil: 'networkidle', timeout: 45000 });
    results.layout[key] = await mobilePage.evaluate(() => {
      const details = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parent = element.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        const parentStyle = parent ? getComputedStyle(parent) : null;
        return {
          selector,
          rect: { left: rect.left, right: rect.right, width: rect.width },
          display: style.display,
          width: style.width,
          maxWidth: style.maxWidth,
          minWidth: style.minWidth,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          boxSizing: style.boxSizing,
          gridTemplateColumns: style.gridTemplateColumns,
          overflowX: style.overflowX,
          parent: parent ? {
            tag: parent.tagName.toLowerCase(),
            id: parent.id || '',
            className: typeof parent.className === 'string' ? parent.className : '',
            rect: parentRect ? { left: parentRect.left, right: parentRect.right, width: parentRect.width } : null,
            display: parentStyle?.display || null,
            width: parentStyle?.width || null,
            maxWidth: parentStyle?.maxWidth || null,
            minWidth: parentStyle?.minWidth || null,
            paddingLeft: parentStyle?.paddingLeft || null,
            paddingRight: parentStyle?.paddingRight || null,
            boxSizing: parentStyle?.boxSizing || null,
            gridTemplateColumns: parentStyle?.gridTemplateColumns || null,
            overflowX: parentStyle?.overflowX || null,
          } : null,
        };
      };
      return {
        status: document.readyState,
        viewport: window.innerWidth,
        htmlScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        shell: details('.demo-v2-shell, .v10-shell'),
        hero: details('.demo-v2-hero, .v10-page-hero'),
        heroFirst: details('.demo-v2-hero > div, .v10-page-hero > div'),
        outcome: details('.demo-v2-outcome-card'),
        dataTable: details('.data-boundary-table'),
        dataTableRow: details('.data-boundary-table > div'),
        limitations: details('.v10-limitations-layout'),
        limitationsChild: details('.v10-limitations-layout > *'),
      };
    });
    results.layout[key].httpStatus = response?.status() ?? null;
    await mobilePage.close();
  }
  await mobile.close();
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outDir, 'verification.json'), JSON.stringify(results, null, 2));
const summary = [
  '# Public production UX verification',
  '',
  `Generated: ${results.generatedAt}`,
  `Base URL: ${baseUrl}`,
  '',
  '## Assessment hidden controls',
  `- Back: ${JSON.stringify(results.assessment.controls?.back || null)}`,
  `- Continue: ${JSON.stringify(results.assessment.controls?.next || null)}`,
  `- Submit: ${JSON.stringify(results.assessment.controls?.submit || null)}`,
  `- Visible elements carrying [hidden]: ${JSON.stringify(results.assessment.controls?.hiddenElementsVisible || [])}`,
  '',
  '## Mobile layout',
  `- Demo: ${JSON.stringify(results.layout.demo || null)}`,
  `- Trust: ${JSON.stringify(results.layout.trust || null)}`,
  '',
].join('\n');
await fs.writeFile(path.join(outDir, 'summary.md'), summary);
console.log(summary);
