import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('assessment loads the compact workflow correction last', () => {
  const html = read('public/assessment.html');
  assert.match(html, /\/assessment-revision-scroll-fix\.css[^\n]*\/assessment-flow-compact\.css/);
});

test('question workflow keeps progress and navigation available without changing assessment semantics', () => {
  const css = read('public/assessment-flow-compact.css');
  assert.match(css, /#questionStage:not\(\[hidden\]\)[\s\S]*?\.assessment-progress\s*\{[\s\S]*?position:\s*fixed\s*!important/);
  assert.match(css, /#questionStage:not\(\[hidden\]\)[\s\S]*?\.assessment-actions\s*\{[\s\S]*?position:\s*fixed\s*!important/);
  assert.match(css, /#assessmentForm[\s\S]*?padding-bottom:\s*108px/);
  assert.match(css, /Presentation only:[\s\S]*?Does not change question applicability, scoring, evidence semantics, findings, authorisation or persistence/);
});

test('normal question mode removes repeated page chrome and uses desktop width efficiently', () => {
  const css = read('public/assessment-flow-compact.css');
  assert.match(css, /\.assessment-intro\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.assessment-phase-label,[\s\S]*?\.assessment-phase-track\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /@media \(min-width:\s*760px\)[\s\S]*?\.guided-option-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(css, /\.guided-option\.not-sure\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});

test('evidence remains optional and collapsed when moving to a new question', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');
  assert.match(html, /<summary>Evidence \(optional\)<\/summary>/);
  assert.match(js, /if \(evidenceDetails\) evidenceDetails\.open = false;/);
});

test('question transitions use a stable immediate viewport instead of page-top smooth scrolling', () => {
  const js = read('public/assessment.js');
  assert.match(js, /function positionCurrentStage\([\s\S]*?window\.scrollTo\(\{ top: targetTop, behavior: 'auto' \}\)/);
  assert.doesNotMatch(js, /window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
  assert.match(js, /stepIndex \+= 1;[\s\S]*?renderStep\(\);[\s\S]*?positionCurrentStage\(\);/);
  assert.match(js, /stepIndex -= 1;[\s\S]*?renderStep\(\);[\s\S]*?positionCurrentStage/);
});

test('question heading is focusable without forcing the browser to scroll', () => {
  const html = read('public/assessment.html');
  const js = read('public/assessment.js');
  assert.match(html, /<h2 id="questionTitle" tabindex="-1"><\/h2>/);
  assert.match(js, /questionTitle\?\.focus\(\{ preventScroll: true \}\)/);
});
