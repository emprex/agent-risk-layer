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

test('revision answer navigator stays secondary and readable', () => {
  const css = read('public/assessment-light-fix.css');
  assert.match(css, /\.assessment-review-layout:has\(\.revision-question-nav:not\(\[hidden\]\)\)[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*268px\)\s+minmax\(0,\s*1fr\)\s*!important/);
  assert.match(css, /\.revision-question-nav\s*\{[\s\S]*?background:\s*#f8fafc\s*!important[\s\S]*?color:\s*#0f172a\s*!important/);
  assert.match(css, /\.revision-question-link\.active[\s\S]*?background:\s*#eff6ff\s*!important/);
});

test('revision scroll correction bounds only the answer list instead of lengthening the whole page', () => {
  const html = read('public/assessment.html');
  const css = read('public/assessment-revision-scroll-fix.css');
  assert.match(html, /\/assessment-light-fix\.css[^\n]*\/assessment-revision-scroll-fix\.css/);
  assert.match(css, /\.revision-question-nav\s*\{[\s\S]*?position:\s*sticky\s*!important[\s\S]*?overflow:\s*visible\s*!important/);
  assert.match(css, /\.revision-question-list\s*\{[\s\S]*?max-height:\s*calc\(100vh - 270px\)\s*!important[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.doesNotMatch(css, /\.revision-question-nav\s*\{[\s\S]*?overflow:\s*auto\s*!important/);
});

test('revision navigator stacks above the editor on narrower screens', () => {
  const css = read('public/assessment-light-fix.css');
  const scrollCss = read('public/assessment-revision-scroll-fix.css');
  assert.match(css, /@media \(max-width:\s*960px\)[\s\S]*?\.assessment-review-layout:has\(\.revision-question-nav:not\(\[hidden\]\)\)[\s\S]*?flex-direction:\s*column\s*!important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.revision-question-list[\s\S]*?grid-template-columns:\s*1fr\s*!important/);
  assert.match(scrollCss, /@media \(max-width:\s*960px\)[\s\S]*?\.revision-question-nav[\s\S]*?position:\s*static\s*!important/);
});

test('selected final answer presents the questionnaire as 100 percent complete before submit', () => {
  const css = read('public/assessment-light-fix.css');
  assert.match(css, /#assessmentForm:has\(#submitAssessment:not\(\[hidden\]\)\):has\(input\[name="currentQuestion"\]:checked\) \.progress-bar[\s\S]*?width:\s*100%\s*!important/);
  assert.match(css, /#progressText::after[\s\S]*?content:\s*"100%"/);
});
