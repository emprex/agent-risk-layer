import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('result page loads light score styling and summary-integrity module after the main result renderer', () => {
  const html = read('public/result.html');
  assert.match(html, /\/workspace-app\.css[^\n]*\/result-light-fix\.css/);
  assert.match(html, /\/result\.js[^\n]*\/result-summary-integrity\.js/);
});

test('result score card is readable in the light workspace', () => {
  const css = read('public/result-light-fix.css');
  assert.match(css, /\.result-side-risk[\s\S]*?background:\s*#f8fafc\s*!important/);
  assert.match(css, /\.result-side-risk > strong[\s\S]*?color:\s*#0f172a\s*!important/);
  assert.match(css, /\.risk-pill\.critical[\s\S]*?background:\s*#fef2f2\s*!important/);
});

test('missing highest severity is derived only after the result root has rendered finding severity badges', () => {
  const js = read('public/result-summary-integrity.js');
  assert.match(js, /function resultHasRendered\(\)/);
  assert.match(js, /root\.classList\.contains\('result-workspace'\)/);
  assert.match(js, /root\.querySelector\('\.result-reason-grid'\)/);
  assert.match(js, /querySelectorAll\('#priorityRisks \.finding-work-item'\)/);
  assert.match(js, /querySelector\(':scope > summary \.severity'\)/);
  assert.match(js, /if \(!findingCount\) return true/);
  assert.match(js, /\^\(\?:none\|—\|-\)\?\$/i);
  assert.doesNotMatch(js, /root\.querySelector\('\.result-workspace'\)/);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|\/api\//);
});
