import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, intelligenceSource, focusedSource, mappingSource] = await Promise.all([
  readFile(new URL('../public/control-plane.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/control-intelligence.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/control-intelligence-control.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/assessment-fix-controls.js', import.meta.url), 'utf8'),
]);
const knowledge = JSON.parse(await readFile(new URL('../public/risk-knowledge-public-v1.1.json', import.meta.url), 'utf8'));

test('assessment remediation offers one calm bulk planning action', () => {
  assert.match(source, /Create the complete remediation plan/);
  assert.match(source, /Assign the remaining/);
  assert.match(source, /Assign \$\{remaining\.length\} remaining fix/);
  assert.match(source, /This records responsibility only/);
  assert.match(source, /defaultRemediationOwner/);
});

test('bulk planning remains assessment-bound and does not create proof', () => {
  assert.match(source, /assessmentId,/);
  assert.match(source, /findingKey: remediationFindingKey\(assessmentId, finding\)/);
  assert.doesNotMatch(source, /createBulkRemediations[\s\S]{0,1800}verified_closed/);
});

test('completion state distinguishes assignment, evidence, retest and verification', () => {
  assert.match(source, /Remediation plan created/);
  assert.match(source, /with evidence/);
  assert.match(source, /verified closed/);
  assert.match(source, /Assignment is not proof of implementation/);
  assert.match(source, /Start this fix/);
});

test('customer remediation compresses 17 controls into four guided work packages', () => {
  assert.match(source, /const assessmentWorkPackages = Object\.freeze/);
  for (const title of ['Observe and contain', 'Control authority', 'Protect data and actions', 'Control the deployment']) {
    assert.match(source, new RegExp(title));
  }
  assert.match(source, /Work package \$\{index \+ 1\} of/);
  assert.match(source, /Copy package test pack/);
  assert.match(source, /Expert detail · \$\{packageItems\.length\} individual controls/);
  assert.match(source, /copyRemediationPackage/);
  assert.match(source, /One coordinated run may produce a shared evidence bundle/);
  assert.match(source, /controlProgress\.latestResult !== 'inconclusive'/);
  assert.match(source, /orderedPackageItems\.find\(\(item\) => item\.status !== 'verified_closed'/);
  assert.match(source, /View blocked package/);
});

test('assessment fixes use one shared control registry for implementation playbooks', () => {
  assert.doesNotMatch(source, /const assessmentPlaybooks/);
  assert.match(source, /assessmentFixControl\(findingId\)/);
  for (let index = 1; index <= 17; index += 1) {
    assert.match(mappingSource, new RegExp(`'F-${String(index).padStart(2, '0')}'`));
  }
  assert.match(source, /What done looks like/);
  assert.match(source, /Capture the right proof/);
  assert.match(source, /Copy checklist/);
});

test('assessment fixes do not use the generic inventory snapshot evidence prompt', () => {
  assert.match(source, /An inventory snapshot is not accepted unless it proves this exact control/);
  assert.match(source, /Record matching evidence in Control Intelligence/);
  assert.match(source, /assessmentGuide \|\|/);
});

test('evidence handoff preserves the exact assessment fix and provides a focused foundation', () => {
  assert.match(source, /assessment: assessmentId, finding: findingId, remediation: item\.id/);
  assert.match(intelligenceSource, /Create the evidence foundation once/);
  assert.match(intelligenceSource, /left anything not confirmed as unknown/);
  assert.match(intelligenceSource, /Create foundation and continue/);
  assert.match(intelligenceSource, /handoffQuery/);
  assert.match(intelligenceSource, /Return to remediation plan/);
});

test('F-01 handoff opens its matching audit control without restarting the catalogue', () => {
  assert.match(mappingSource, /'F-01': \{ controlId: 'ARL-KB-090'/);
  assert.match(intelligenceSource, /function handoffWorkspace/);
  assert.match(intelligenceSource, /handoff\.assessmentId\?handoffWorkspace\(\)/);
  assert.match(intelligenceSource, /not observed evidence and not a failed control test/);
  assert.match(intelligenceSource, /Specialist option/);
});

test('focused control keeps assessment remediation context and evidence boundaries', () => {
  assert.match(focusedSource, /const handoff = \{/);
  assert.match(focusedSource, /declared weakness, not an observed failure/);
  assert.match(focusedSource, /existing remediation stays open until implementation evidence exists and the retest passes/);
  assert.match(focusedSource, /Return to remediation plan/);
  assert.match(focusedSource, /You may confirm Applicable with a specific reason/);
  assert.match(focusedSource, /human scope decision, not evidence that the control works/);
  assert.match(focusedSource, /Developer test pack/);
  assert.match(focusedSource, /copyDeveloperTestPack/);
});

test('remediation plan recognises a started or inconclusive control workflow', () => {
  assert.match(source, /assessmentControlProgress/);
  assert.match(source, /assessmentFixControl\(findingId\)/);
  assert.match(source, /Test inconclusive — connect the staging agent/);
  assert.match(source, /Continue this fix/);
  assert.match(source, /Waiting on developer/);
  assert.match(source, /Continue working/);
  assert.match(source, /Test planned — run it when the staging system is available/);
  assert.match(source, /latestAt:/);
  assert.match(source, /lifecycleLabel/);
  assert.match(source, /Test planned/);
  assert.match(source, /No control evidence was created/);
  assert.match(source, /control-intelligence-control\.html/);
  assert.match(source, /Continue evidence task/);
});

test('all assessment fixes have one direct control mapping and a developer test pack', async () => {
  const { ASSESSMENT_FIX_CONTROLS } = await import('../public/assessment-fix-controls.js');
  assert.equal(Object.keys(ASSESSMENT_FIX_CONTROLS).length, 17);
  assert.equal(new Set(Object.values(ASSESSMENT_FIX_CONTROLS).map((task) => task.controlId)).size, 17);
  const catalogueIds = new Set(knowledge.entries.map((control) => control.id));
  for (let index = 1; index <= 17; index += 1) {
    const findingId = `F-${String(index).padStart(2, '0')}`;
    const task = ASSESSMENT_FIX_CONTROLS[findingId];
    assert.ok(task, `${findingId} must be mapped`);
    assert.match(task.controlId, /^ARL-KB-\d{3}$/);
    assert.ok(catalogueIds.has(task.controlId), `${findingId} must map to a real catalogue control`);
    for (const field of ['weakness', 'outcome', 'test', 'proof']) assert.ok(task[field].length > 20, `${findingId}.${field} must be actionable`);
  }
  assert.match(focusedSource, /assessmentFixControl\(handoff\.findingId\)/);
});
