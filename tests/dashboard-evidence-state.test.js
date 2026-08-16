import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardEvidencePresentation } from '../public/dashboard-evidence-state.js';

const readyJourney = {
  status: 'ready-for-deployment-review',
  evidenceCollected: 9,
  steps: [
    { id: 'project', complete: true },
    { id: 'policy', complete: true },
    { id: 'key', complete: true },
    { id: 'allowed', complete: true },
    { id: 'blocked', complete: true },
    { id: 'inventory', complete: true },
    { id: 'findings', complete: true },
    { id: 'remediate', complete: true },
    { id: 'retest', complete: true },
  ],
};

const readyControlIntelligence = {
  systemSnapshot: { id: 'sys_test', versionIdentifier: 'v1' },
  summary: { nextAction: null },
};

test('runtime completion alone does not claim deployment readiness without an immutable system snapshot', () => {
  const view = dashboardEvidencePresentation({ journey: readyJourney, controlIntelligence: { systemSnapshot: null, summary: {} }, projectId: 'prj_test' });
  assert.equal(view.readyForHumanReview, false);
  assert.equal(view.deployment.title, 'Evidence foundation required');
  assert.match(view.deployment.detail, /no immutable system snapshot exists/i);
  assert.equal(view.nextAction.title, 'Describe this exact agent version');
  assert.equal(view.nextAction.label, 'Create evidence foundation');
  assert.equal(view.nextAction.href, '/control-intelligence.html?projectId=prj_test');
  assert.equal(view.showControlSummary, false);
  assert.equal(view.runtimeEvidence, 'Current-policy allow, deny and retest evidence recorded');
});

test('a current snapshot with unfinished control work remains in deployment review', () => {
  const view = dashboardEvidencePresentation({
    journey: readyJourney,
    controlIntelligence: {
      systemSnapshot: { id: 'sys_test' },
      summary: { nextAction: { controlId: 'ARL-KB-031', nextAction: 'Provide missing architecture information and confirm applicability.' } },
    },
    projectId: 'prj_test',
  });
  assert.equal(view.readyForHumanReview, false);
  assert.equal(view.deployment.title, 'Deployment review in progress');
  assert.equal(view.nextAction.title, 'Continue deployment evidence review');
  assert.equal(view.nextAction.label, 'Review next control');
  assert.equal(view.nextAction.href, '/control-intelligence-control.html?projectId=prj_test&controlId=ARL-KB-031');
  assert.equal(view.showControlSummary, true);
});

test('ready runtime and completed control stages ask for human deployment review without inventing a decision', () => {
  const view = dashboardEvidencePresentation({ journey: readyJourney, controlIntelligence: readyControlIntelligence, projectId: 'prj_test' });
  assert.equal(view.readyForHumanReview, true);
  assert.deepEqual(view.deployment, {
    state: 'unresolved',
    title: 'Ready for human review',
    detail: 'The immutable system scope, required control stages and current-policy runtime evidence are complete. No deployment decision has been recorded yet.',
  });
  assert.equal(view.nextAction.title, 'Make the deployment decision');
  assert.equal(view.nextAction.label, 'Review deployment evidence');
  assert.equal(view.nextAction.href, '/control-intelligence.html?projectId=prj_test');
  assert.equal(view.runtimeEvidence, 'Current-policy allow, deny and retest evidence recorded');
  assert.doesNotMatch(view.deployment.title, /proceed|hold|do not deploy/i);
});

test('a server-recorded deployment decision takes precedence over readiness copy', () => {
  const view = dashboardEvidencePresentation({ journey: readyJourney, controlIntelligence: readyControlIntelligence, hasDeploymentDecision: true, projectId: 'prj_test' });
  assert.equal(view.readyForHumanReview, false);
  assert.equal(view.deployment, null);
  assert.equal(view.nextAction.title, 'Review the recorded deployment decision');
  assert.equal(view.nextAction.href, '/control-intelligence.html?projectId=prj_test');
});

test('complete control stages do not claim readiness while the runtime journey is incomplete', () => {
  const view = dashboardEvidencePresentation({
    journey: {
      status: 'evidence-incomplete',
      steps: [
        { id: 'allowed', complete: true },
        { id: 'blocked', complete: false },
        { id: 'retest', complete: false },
      ],
    },
    controlIntelligence: readyControlIntelligence,
    projectId: 'prj_test',
  });
  assert.equal(view.readyForHumanReview, false);
  assert.equal(view.deployment.title, 'Runtime evidence incomplete');
  assert.equal(view.nextAction.title, 'Complete the current-policy runtime evidence');
  assert.equal(view.nextAction.href, '/control-plane.html?projectId=prj_test');
  assert.equal(view.runtimeEvidence, 'Partial current-policy runtime evidence recorded');
});
