import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');

test('KB-006 review command is a read-only human triage, not an automatic closure', () => {
  const start = source.indexOf("if (/^review kb-006 finding[.!?]*$/i.test(request.trim()))");
  const end = source.indexOf("if (/^show assessment context[.!?]*$/i.test(request.trim()))", start);
  assert.ok(start >= 0 && end > start);
  const section = source.slice(start, end);
  assert.match(section, /getControlIntelligenceControl/);
  assert.match(section, /initialFailures/);
  assert.match(section, /findings/);
  assert.match(section, /human_review_required/);
  assert.match(section, /securityStateChanged: false/);
  assert.match(section, /deploymentDecisionWritten: false/);
  assert.doesNotMatch(section, /closeControlFinding|recordControlTestExecution|UPDATE |DELETE |recordRemediation/);
});
