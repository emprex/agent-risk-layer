import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('assessment loads the final light answer-choice correction after workspace styles', () => {
  const html = read('public/assessment.html');
  assert.match(html, /\/workspace-app\.css[^\n]*\/assessment-light-fix\.css/);
});

test('assessment answer cards are light, readable and have an explicit selected state', () => {
  const css = read('public/assessment-light-fix.css');
  assert.match(css, /\.guided-option[\s\S]*?background:\s*#ffffff\s*!important/);
  assert.match(css, /\.guided-option[\s\S]*?color:\s*#0f172a\s*!important/);
  assert.match(css, /:has\(input:checked\)[\s\S]*?background:\s*#eff6ff\s*!important/);
  assert.match(css, /:has\(input:checked\)[\s\S]*?border-color:\s*#2563eb\s*!important/);
});

test('assessment help and evidence disclosures remain light and readable', () => {
  const css = read('public/assessment-light-fix.css');
  assert.match(css, /\.question-guidance,[\s\S]*?\.evidence-details[\s\S]*?background:\s*#ffffff\s*!important/);
  assert.match(css, /\.question-guidance > summary,[\s\S]*?\.evidence-details > summary[\s\S]*?color:\s*#475569\s*!important/);
});

test('selected final answer presents the questionnaire as 100 percent complete before submit', () => {
  const css = read('public/assessment-light-fix.css');
  assert.match(css, /#assessmentForm:has\(#submitAssessment:not\(\[hidden\]\)\):has\(input\[name="currentQuestion"\]:checked\) \.progress-bar[\s\S]*?width:\s*100%\s*!important/);
  assert.match(css, /#progressText::after[\s\S]*?content:\s*"100%"/);
});
