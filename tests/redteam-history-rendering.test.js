import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normaliseRedTeamSummary } from '../public/redteam-view-model.js';

const root=path.resolve(import.meta.dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('Red Team summary view model accepts current complete summaries',()=>{
  const summary=normaliseRedTeamSummary({
    assuranceScore:75,
    riskScore:25,
    caseTotal:1,
    trialTotal:1,
    passRate:0,
    grade:'C',
    decision:'REMEDIATE BEFORE RELEASE',
    counts:{passed:0,failed:1,inconclusive:0,error:0,critical:1,high:0,medium:0,low:0}
  });
  assert.equal(summary?.counts.failed,1);
  assert.equal(summary?.counts.critical,1);
  assert.equal(summary?.assuranceScore,75);
});

test('Red Team summary view model rejects missing or malformed legacy summary metadata instead of inventing zero risk',()=>{
  assert.equal(normaliseRedTeamSummary(undefined),null);
  assert.equal(normaliseRedTeamSummary({}),null);
  assert.equal(normaliseRedTeamSummary({counts:{}}),null);
  assert.equal(normaliseRedTeamSummary({assuranceScore:100,riskScore:0,caseTotal:0,grade:'A',decision:'CONTROLLED TESTS PASSED'}),null);
});

test('Red Team campaign history renders retained runs without summary counts as unavailable metadata',()=>{
  const source=read('public/redteam.js');
  assert.match(source,/normaliseRedTeamSummary\(x\?\.summary\)/);
  assert.match(source,/Run summary unavailable/);
  assert.match(source,/no assurance score or deployment decision is inferred from missing summary metadata/);
});

test('Red Team run detail fails evidence-neutrally when summary metadata is incomplete',()=>{
  const source=read('public/redteam-run.js');
  assert.match(source,/normaliseRedTeamSummary\(run\?\.summary\)/);
  assert.match(source,/AgentRiskLayer does not infer an assurance score or deployment decision from absent fields/);
  assert.match(source,/Controlled adapter evidence/);
  assert.doesNotMatch(source,/Controlled staging evidence/);
});

test('Red Team run listing resolves async public summaries before HTTP serialization',()=>{
  const source=read('src/redteam.js');
  assert.match(source,/return await Promise\.all\(rows\.map\(publicRunSummary\)\)/);
  assert.doesNotMatch(source,/\.all\(assessmentId, userId\)\)\.map\(publicRunSummary\)/);
});
