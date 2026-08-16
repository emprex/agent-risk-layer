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

test('ready technical evidence asks for human deployment review without inventing a decision', () => {
  const view = dashboardEvidencePresentation({ journey: readyJourney, projectId: 'prj_test' });
  assert.equal(view.readyForHumanReview, true);
  assert.deepEqual(view.deployment, {
    state: 'unresolved',
    title: 'Ready for human review',
    detail: 'Required technical evidence is complete for the current project policy. No deployment decision has been recorded yet.',
  });
  assert.equal(view.nextAction.title, 'Make the deployment decision');
  assert.equal(view.nextAction.label, 'Review deployment evidence');
  assert.equal(view.nextAction.href, '/control-intelligence.html?projectId=prj_test');
  assert.equal(view.runtimeEvidence, 'Current-policy allow, deny and retest evidence recorded');
  assert.doesNotMatch(view.deployment.title, /proceed|hold|do not deploy/i);
});

test('a server-recorded deployment decision takes precedence over readiness copy', () => {
  const view = dashboardEvidencePresentation({ journey: readyJourney, hasDeploymentDecision: true, projectId: 'prj_test' });
  assert.equal(view.deployment, null);
  assert.equal(view.nextAction.title, 'Review the recorded deployment decision');
  assert.equal(view.nextAction.href, '/control-intelligence.html?projectId=prj_test');
});

test('incomplete technical evidence does not override the assessment-led next action', () => {
  const view = dashboardEvidencePresentation({
    journey: {
      status: 'evidence-incomplete',
      steps: [
        { id: 'allowed', complete: true },
        { id: 'blocked', complete: false },
        { id: 'retest', complete: false },
      ],
    },
    projectId: 'prj_test',
  });
  assert.equal(view.deployment, null);
  assert.equal(view.nextAction, null);
  assert.equal(view.runtimeEvidence, 'Partial current-policy runtime evidence recorded');
});
