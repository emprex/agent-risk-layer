import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspacePages = [
  'public/dashboard.html',
  'public/result.html',
  'public/control-intelligence.html',
  'public/assessment.html',
  'public/control-plane.html',
  'public/inspector.html',
];

test('authenticated customer surfaces use the shared source-level workspace and no legacy overlay', () => {
  for (const page of workspacePages) {
    const html = read(page);
    assert.match(html, /\/security-workspace\.css/);
    assert.match(html, /\/workspace-app\.css/);
    assert.doesNotMatch(html, /\/workspace-ux\.(?:css|js)/);
  }
  for (const page of ['public/index.html', 'public/pricing.html', 'public/trust.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /\/security-workspace\.css|\/workspace-app\.css/);
  }
});

test('shared authenticated shell owns one customer navigation vocabulary and context remains non-authoritative', () => {
  const js = read('public/site-shell.js');
  for (const label of ['Overview', 'Assess', 'Findings', 'Evidence', 'Runtime', 'Settings']) {
    assert.match(js, new RegExp(`label: '${label}'`));
  }
  assert.match(js, /dataset\.workspaceNavigation = 'true'/);
  assert.match(js, /sessionStorage\.setItem\('arl_selected_project'/);
  assert.match(js, /sessionStorage\.setItem\('arl_selected_assessment'/);
  assert.match(js, /navigation hints only/);
  assert.match(js, /Destination APIs remain responsible/);
  assert.doesNotMatch(js, /textContent = 'Control Intelligence'/);
});

test('dashboard is organised around agents and keeps deployment decisions server-authoritative', () => {
  const js = read('public/dashboard.js');
  const evidenceState = read('public/dashboard-evidence-state.js');
  assert.match(js, /function groupAssessments/);
  assert.match(js, /Current agent/);
  assert.match(js, /Latest assessment/);
  assert.match(js, /Next action/);
  assert.match(js, /control-intelligence\?limit=1/);
  assert.match(js, /dashboardEvidencePresentation/);
  assert.match(js, /controlIntelligence: payload/);
  assert.match(js, /presentation\.showControlSummary/);
  assert.match(js, /api\(`\/api\/projects\/\$\{encodeURIComponent\(project\.id\)\}`\)/);
  assert.match(js, /No decision recorded/);
  assert.match(js, /No HOLD or PROCEED state is inferred/);
  assert.match(js, /Previous assessments/);
  assert.match(evidenceState, /Evidence foundation required/);
  assert.match(evidenceState, /Deployment review in progress/);
  assert.match(evidenceState, /ready-for-deployment-review/);
  assert.match(evidenceState, /Ready for human review/);
  assert.match(evidenceState, /immutable system scope/);
  assert.match(evidenceState, /Make the deployment decision/);
  assert.match(evidenceState, /Current-policy allow, deny and retest evidence recorded/);
});

test('assessment keeps the questionnaire while presenting five human phases without a raw denominator', () => {
  const js = read('public/assessment.js');
  for (const label of ['Agent & access', 'Data & inputs', 'Actions & authority', 'Controls & approval', 'Recovery & evidence']) {
    assert.match(js, new RegExp(label.replace(/[&]/g, '\\&')));
  }
  assert.match(js, /`Question \$\{questionnaireNumber\(question\)\}`/);
  assert.doesNotMatch(js, /Step \$\{stepIndex \+ 1\} of/);
  assert.match(js, /answers\.set\(question\.id/);
  assert.match(js, /sourceAssessmentId/);
});

test('result presents posture, reasons and next action before progressively disclosed detail', () => {
  const js = read('public/result.js');
  assert.match(js, /Current assessment posture/);
  assert.match(js, /result-reason-grid/);
  assert.match(js, /result-next-action/);
  assert.match(js, /items\.slice\(0, 3\)/);
  assert.match(js, /finding-work-item/);
  assert.match(js, /Unknown information is not a vulnerability/);
  assert.match(js, /Get Security Assessment · £99/);
  assert.match(js, /does not claim inspection, testing or human review unless corresponding evidence exists/);
});

test('Control Intelligence does not invent HOLD and persists only an authorised project returned by the server', () => {
  const js = read('public/control-intelligence.js');
  assert.match(js, /No deployment decision recorded/);
  assert.match(js, /No HOLD, PROCEED or DO NOT DEPLOY state is inferred/);
  assert.doesNotMatch(js, /d\?\.decision\|\|'hold'/);
  assert.match(js, /allowed=projects\.find\(project=>project\.id===requested\)/);
  assert.match(js, /initial=allowed\?\.id\|\|projects\[0\]\?\.id\|\|''/);
  assert.match(js, /sessionStorage\.setItem\('arl_selected_project'/);
  assert.match(js, /Current deployment state/);
});

test('Inspector keeps observed evidence attached to an explicit assessment context', () => {
  const js = read('public/inspector.js');
  assert.match(js, /Assessment context/);
  assert.match(js, /Evidence class/);
  assert.match(js, /Observed/);
  assert.match(js, /sessionStorage\.setItem\('arl_selected_assessment'/);
  assert.match(js, /Source code and secret values are excluded/);
  assert.match(js, /not remote attestation/);
});

test('documentation records replacement of the old DOM rearrangement approach', () => {
  const doc = read('COMMERCIAL_WORKSPACE_UX.md');
  assert.match(doc, /replaces the previous `workspace-ux\.js` \/ `workspace-ux\.css` DOM-rearrangement experiment/);
  assert.match(doc, /Client-side navigation state is not authorisation/);
  assert.match(doc, /Runtime completion by itself is not deployment-review readiness/);
  assert.match(doc, /Declared is not observed/);
  assert.equal(existsSync(new URL('../public/security-workspace.css', import.meta.url)), true);
  assert.equal(existsSync(new URL('../public/workspace-app.css', import.meta.url)), true);
});
