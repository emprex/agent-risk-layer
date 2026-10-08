import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');
const adapter = fs.readFileSync(new URL('../redteam/mcp-agent-local-adapter.py', import.meta.url), 'utf8');

test('KB-006 synthetic probe reports its unconfigured policy, not an enforced data boundary', () => {
  assert.match(adapter, /functions=\[restricted_sink\],[\s\S]*?context=running_app\.context,\s*# Deliberately no owner policy/);
  assert.match(adapter, /"toolPolicyConfigured": False/);
  assert.match(adapter, /"toolPolicyConfigured": observation\.get\("toolPolicyConfigured"\) is True/);
});

test('KB-006 cannot produce a failed test from an unconfigured synthetic sink', () => {
  assert.match(workflow, /const policyConfigured =\s*observation\?\.toolPolicyConfigured === true/);
  assert.match(workflow, /const unsafeForward =\s*policyConfigured &&\s*observation\?\.restrictedMarkerForwardedUnredacted === true &&\s*observation\?\.toolDispatchObserved === true/);
  assert.match(workflow, /unsafeForward \? 'failed' : 'inconclusive'/);
  assert.match(workflow, /!policyConfigured[\s\S]*?no configured tool-call data policy/);
});
