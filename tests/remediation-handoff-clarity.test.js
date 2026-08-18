import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exactAssessmentProject, assessmentConcernCopy } from '../public/remediation-handoff-model.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('remediation handoff keeps assessment declarations separate from verified findings', () => {
  const copy = assessmentConcernCopy();
  assert.equal(copy.label, 'Assessment concern to verify');
  assert.match(copy.explanation, /declared context, not a verified finding/i);

  const model = read('public/remediation-handoff-model.js');
  const layer = read('public/remediation-handoff-clarity.js');
  assert.match(model, /Assessment concern to verify/);
  assert.match(model, /not a verified finding/);
  assert.doesNotMatch(`${model}\n${layer}`, /create.*finding|verified.*true/i);

  const html = read('public/control-plane.html');
  assert.match(html, /remediation-handoff-clarity\.js/);
  assert.match(html, /fix confirmed weaknesses and retest the exact control/i);
});

test('exact assessment project match requires both exact name and environment', () => {
  const overview = {
    projects: [
      { id: 'wrong-env', name: 'Northstar Support Agent — staging v2.3', environment: 'production' },
      { id: 'exact', name: 'Northstar Support Agent — staging v2.3', environment: 'staging' },
      { id: 'other', name: 'Northstar Support Agent', environment: 'staging' },
    ],
  };
  const assessment = {
    name: 'Northstar Support Agent — staging v2.3',
    result: { systemDescription: 'Synthetic staging deployment.' },
  };
  assert.equal(exactAssessmentProject(overview, assessment)?.id, 'exact');
  assert.equal(exactAssessmentProject({ projects: [overview.projects[0]] }, assessment), null);
});

test('exact existing project reuse removes only the misleading slot blocker', () => {
  const layer = read('public/remediation-handoff-clarity.js');
  assert.match(layer, /exact name and environment match/);
  assert.match(layer, /Reusing it does not consume a new project slot/);
  assert.match(layer, /no unused project slot/i);
  assert.match(layer, /if \(!exact\) return/);
  assert.match(layer, /select\.value = exact\.id/);
});

test('handoff DOM observer disconnects before clarification mutates the same subtree', () => {
  const layer = read('public/remediation-handoff-clarity.js');
  assert.match(layer, /observer\.disconnect\(\);\s*\n\s*decorate\(\);/);
  assert.match(layer, /let decorated = false/);
  assert.match(layer, /if \(decorated\) return/);
  assert.doesNotMatch(layer, /new MutationObserver\(\(\) => decorate\(\)\)/);
});
