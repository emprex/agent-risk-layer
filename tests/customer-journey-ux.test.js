import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('public/customer-journey-ux.css');
const assessment = read('public/assessment.html');
const demo = read('public/demo.html');
const trust = read('public/trust.html');

test('assessment restores semantic hidden controls despite component display rules', () => {
  assert.match(assessment, /customer-journey-ux\.css/);
  assert.match(assessment, /hidden="" id="revisionReviewField"/);
  assert.match(assessment, /hidden="" id="backButton"/);
  assert.match(assessment, /hidden="" id="submitAssessment"/);
  assert.match(css, /\.assessment-shell \[hidden\]\s*\{\s*display:\s*none\s*!important;/s);
});

test('demo mobile hero cannot expand its grid track beyond the viewport', () => {
  assert.match(demo, /customer-journey-ux\.css/);
  assert.match(css, /\.demo-v2-hero\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.demo-v2-hero\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
});

test('trust limitations grid cannot use an overflowing min-content track on mobile', () => {
  assert.match(trust, /customer-journey-ux\.css/);
  assert.match(css, /\.v10-limitations-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.v10-limitations-layout\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
});
