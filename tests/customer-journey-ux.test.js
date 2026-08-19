import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('public/customer-journey-ux.css');
const assessment = read('public/assessment.html');
const demo = read('public/demo.html');
const trust = read('public/trust.html');
const help = read('public/help.html');
const resultSummaryIntegrity = read('public/result-summary-integrity.js');

test('assessment restores semantic hidden controls despite component display rules', () => {
  assert.match(assessment, /customer-journey-ux\.css/);
  assert.match(assessment, /hidden="" id="revisionReviewField"/);
  assert.match(assessment, /hidden="" id="backButton"/);
  assert.match(assessment, /hidden="" id="submitAssessment"/);
  assert.match(css, /\.assessment-shell \[hidden\]\s*\{\s*display:\s*none\s*!important;/s);
});

test('demo mobile hero contains its grid and large product-name heading', () => {
  assert.match(demo, /customer-journey-ux\.css/);
  assert.match(css, /\.demo-v2-hero\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.demo-v2-hero\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.demo-v2-hero h1\s*\{\s*font-size:\s*clamp\(40px,\s*11vw,\s*45px\);/s);
});

test('trust limitations section contains its grid and large product-name heading', () => {
  assert.match(trust, /customer-journey-ux\.css/);
  assert.match(css, /\.v10-limitations-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.v10-limitations-layout\s*>\s*\*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.v10-limitations-layout h2\s*\{\s*font-size:\s*clamp\(34px,\s*10vw,\s*40px\);/s);
});

test('Help Centre uses the current assessment evidence vocabulary and verification boundary', () => {
  assert.doesNotMatch(help, /“Owner statement” means asserted/);
  assert.doesNotMatch(help, /“documented” means a reviewable record exists/);
  assert.doesNotMatch(help, /“tested” means a repeatable check has passed/);
  assert.match(help, /“No proof yet” records no supporting evidence/);
  assert.match(help, /“My answer only \(not verified\)” records a customer assertion only/);
  assert.match(help, /“I have supporting evidence to attach \(not verified yet\)”/);
  assert.match(help, /Selecting an option in the assessment never creates verified evidence/);
  assert.match(help, /merely selecting an evidence option does not verify it/);
});

test('result prioritizes high or critical findings over unresolved information gaps', () => {
  assert.match(resultSummaryIntegrity, /severity === 'critical' \|\| severity === 'high'/);
  assert.match(resultSummaryIntegrity, /insertBefore\(prioritySection, informationSection\)/);
  assert.match(resultSummaryIntegrity, /Information gaps remain separate and should still be confirmed, but they do not outrank a known deployment blocker/);
  assert.match(resultSummaryIntegrity, /Open highest-priority finding/);
  assert.match(resultSummaryIntegrity, /Start remediation/);
});

test('result priority repair preserves unknowns as information gaps rather than findings', () => {
  assert.match(resultSummaryIntegrity, /const informationSection = root\.querySelector\('#informationNeeded'\)/);
  assert.match(resultSummaryIntegrity, /if \(!informationSection \|\| !finding\) return true/);
  assert.doesNotMatch(resultSummaryIntegrity, /informationSection\.remove\(/);
  assert.doesNotMatch(resultSummaryIntegrity, /informationSection\.hidden\s*=\s*true/);
});
