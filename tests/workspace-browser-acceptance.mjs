import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = 'http://127.0.0.1:4173';
const out = 'test-artifacts/workspace-browser';
await mkdir(out, { recursive: true });

const assessments = [
  { id: 'a1', access_token: 't1', name: 'CLARA v2.6', agent_type: 'Customer support agent', risk_band: 'High', score: 68, created_at: '2026-08-14T12:00:00Z', scoring_version: 'arl-risk-v3.4', latest_inspection_summary: { id: 'i1' }, latest_redteam_summary: { id: 'r1' } },
  { id: 'a0b', access_token: 't0b', name: 'CLARA v2.6', agent_type: 'Customer support agent', risk_band: 'High', score: 74, created_at: '2026-08-12T12:00:00Z', scoring_version: 'arl-risk-v3.4' },
  { id: 'a0a', access_token: 't0a', name: 'CLARA v2.6', agent_type: 'Customer support agent', risk_band: 'Critical', score: 82, created_at: '2026-08-10T12:00:00Z', scoring_version: 'arl-risk-v3.4' },
  { id: 'b1', access_token: 'tb1', name: 'RefundMate', agent_type: 'Finance agent', risk_band: 'Moderate', score: 45, created_at: '2026-08-13T12:00:00Z', scoring_version: 'arl-risk-v3.4' },
];

const dashboard = {
  user: { email: 'buyer@example.com', emailVerified: true, isSuperuser: false, mfaEnabled: false },
  stats: { assessments: 4, critical: 1 },
  assessments,
  purchases: [],
  subscription: null,
  controlPlane: {
    entitlement: { name: 'Community', projects: 1, runtimeRequestsPerMonth: 10000, retentionDays: 7 },
    totals: { openRemediations: 1, runtimeRequestsMonth: 87 },
    projects: [{ id: 'prj_clara', name: 'CLARA v2.6', projectKind: 'runtime', environment: 'production', remediations: [] }],
    assessmentCases: { projects: [] },
  },
};

const resultAssessment = {
  id: 'a1', name: 'CLARA v2.6', agentType: 'Customer support agent', createdAt: '2026-08-14T12:00:00Z', paidTier: 'pro', score: 68, riskBand: 'High', publicEnabled: false,
  methodology: 'Declared answers are assessed separately from observed and test-generated evidence.',
  controls: [
    { name: 'Exact-action approval', status: 'action', evidence: 'customer_assertion' },
    { name: 'Tenant-scoped access', status: 'verified', evidence: 'reviewed evidence' },
  ],
  result: {
    decision: 'DEPLOY ONLY AFTER MATERIAL REMEDIATION', scoreAvailable: true, evidenceConfidence: 42, highestFindingSeverity: 'critical', inherentRisk: 82, controlGap: 61, assessmentCompleteness: 100,
    systemDescription: 'Customer support agent with refund tooling and production customer records.',
    findings: [
      { id: 'F-01', title: 'Refund approval boundary is not enforced', severity: 'critical', observed: 'The declared flow permits the agent to prepare a refund without an exact-action approval binding.', impact: 'An unsafe or manipulated request could reach a high-impact refund action.', recommendation: 'Bind approval to the exact target, action, value and validity window.', evidence: 'customer assertion', frameworks: ['ARL-RKA-1.2.0'], tags: ['approval', 'high-impact'] },
      { id: 'F-02', title: 'Runtime deny path is not yet proven', severity: 'high', observed: 'Runtime blocking is declared but lacks reviewed test evidence.', impact: 'A denied action may not be reliably contained.', recommendation: 'Run the exact denied-action test and retain the runtime decision evidence.', evidence: 'customer assertion', tags: ['monitoring'] },
      { id: 'F-03', title: 'Recovery exercise is missing', severity: 'high', observed: 'A recovery procedure is declared without a timed exercise.', impact: 'Containment and restoration may take longer during an incident.', recommendation: 'Run and record a bounded recovery exercise.', evidence: 'customer assertion', tags: ['incident-response'] },
      { id: 'F-04', title: 'Credential scope needs review', severity: 'medium', observed: 'A shared service credential is declared.', impact: 'Compromise could expose broader access than necessary.', recommendation: 'Use a scoped service identity.', evidence: 'customer assertion', tags: ['secrets'] },
    ],
    recommendations: [{ text: 'Enforce exact-action approval before refund execution.', priority: 'P0' }],
  },
};

const questions = Array.from({ length: 10 }, (_, index) => ({
  id: `q${index + 1}`,
  domain: ['Access', 'Data', 'Actions', 'Approval', 'Recovery'][Math.min(4, Math.floor(index / 2))],
  kind: index < 4 ? 'exposure' : 'control',
  title: `Security question ${index + 1}`,
  help: 'Choose what is true in the current deployed version.',
  options: [
    { value: 'yes', label: 'Yes — currently true' },
    { value: 'no', label: 'No — currently false' },
    { value: 'unknown', label: 'I’m not sure' },
  ],
}));

const ciPayload = {
  systemSnapshot: {
    id: 'snap1', versionIdentifier: 'CLARA v2.6 · production', contentDigest: 'sha256:0123456789abcdef', architecture: { summary: 'Customer support agent' }, models: [], tools: [], identities: [], dataSources: [], networkAccess: [], approvalConfiguration: {},
    assessmentConfiguration: { capabilityProfile: {}, architectureFacts: ['environment:production'], manualArchitectureFacts: ['environment:production'], environment: 'production' },
  },
  suggestionProfile: { version: 'ARL-RKA-1.2.0' }, suggestionProfile: { version: 'ARL-RKA-1.2.0' },
  deploymentState: { id: 'dec1', decision: 'HOLD', rationale: 'A critical remediation and exact retest remain open.' },
  summary: { suggestedControls: 8, suggestedReviewedControls: 5, candidatesNeedingReview: 3, applicableControls: 5, testsToRun: 2, controlsMissingEvidence: 2, findingsAwaitingRemediation: 1, retestsRequired: 1, approvalsRequired: 0, deploymentBlockers: 2, nextAction: { controlId: 'ARL-KB-031', controlTitle: 'Exact-action approval', nextAction: 'Retest the refund approval boundary' } },
  items: [{ controlId: 'ARL-KB-031', controlTitle: 'Exact-action approval', category: 'Tools / Agent Authority', currentStage: 'testing', nextAction: 'Retest exact-action approval', applicabilityDigest: 'digest1', suggestion: { level: 'suggested', rationale: 'The agent can execute financial actions.', triggeringFacts: ['authority:financial'] } }],
  hasMore: false, limit: 25,
};

const inspections = [{ id: 'i1', createdAt: '2026-08-14T12:30:00Z', scannerVersion: '10.1.1', summary: { postureScore: 72, grade: 'B', findingsTotal: 2, counts: { critical: 0, high: 1, medium: 1 } }, delta: { status: 'first-scan', postureChange: 0 } }];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApis(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/me') return json(route, { user: dashboard.user });
    if (path === '/api/dashboard') return json(route, dashboard);
    if (path === '/api/questionnaire') return json(route, { questionnaire: questions, evidenceOptions: [{ value: 'none', label: 'None' }, { value: 'customer_assertion', label: 'Customer assertion' }, { value: 'evidence_ready', label: 'Evidence ready' }] });
    if (path === '/api/config') return json(route, { demoMode: false });
    if (path === '/api/assessments/a1') return json(route, { assessment: resultAssessment, isOwner: true, revisionSource: null });
    if (path === '/api/assessments/a1/inspections') return json(route, { inspections });
    if (path === '/api/control-plane/overview') return json(route, { projects: dashboard.controlPlane.projects, assessmentCases: { projects: [] } });
    if (path === '/api/projects/prj_clara/control-intelligence') return json(route, ciPayload);
    if (request.method() === 'POST' && path === '/api/auth/logout') return json(route, { ok: true });
    return json(route, { error: `Browser fixture has no mock for ${request.method()} ${path}` }, 404);
  });
}

async function waitForWorkspace(page) {
  await page.waitForFunction(() => document.body.dataset.shell === 'app');
  await page.waitForTimeout(120);
}

function capturePageErrors(page, label) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror ${label}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console ${label}: ${message.text()}`); });
  return errors;
}

async function assertNoOverflow(page, label) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  if (widths.document > widths.viewport + 1 || widths.body > widths.viewport + 1) throw new Error(`${label} horizontal overflow: ${JSON.stringify(widths)}`);
}

async function assertNav(page, label) {
  const labels = await page.locator('[data-primary-navigation] a').allTextContents();
  const expected = ['Overview', 'Assess', 'Findings', 'Evidence', 'Runtime', 'Settings', 'Help'];
  for (const item of expected) if (!labels.includes(item)) throw new Error(`${label} missing workspace nav ${item}: ${labels.join(' | ')}`);
  for (const forbidden of ['Product', 'See it work', 'Pricing', 'Control Intelligence', 'Live protection']) if (labels.includes(forbidden)) throw new Error(`${label} retained competing nav label ${forbidden}`);
}

const browser = await chromium.launch();
const viewports = [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }];
const report = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await mockApis(page);
  const errors = capturePageErrors(page, viewport.name);

  await page.goto(`${base}/dashboard.html?assessment=a1`, { waitUntil: 'networkidle' });
  await waitForWorkspace(page);
  await page.waitForSelector('#deploymentEvidenceState strong:not(:has-text("Loading"))');
  if ((await page.locator('#activeAgentTitle').textContent())?.trim() !== 'CLARA v2.6') throw new Error(`${viewport.name} dashboard did not centre the selected agent`);
  if ((await page.locator('#deploymentEvidenceState strong').textContent())?.trim() !== 'HOLD') throw new Error(`${viewport.name} dashboard did not surface server-recorded decision`);
  if (await page.locator('text=Welcome back').count()) throw new Error(`${viewport.name} dashboard still leads with account greeting`);
  if ((await page.locator('text=Previous assessments (2)').count()) !== 1) throw new Error(`${viewport.name} dashboard did not group historical CLARA assessments`);
  await assertNav(page, `${viewport.name} dashboard`);
  await assertNoOverflow(page, `${viewport.name} dashboard`);
  await page.screenshot({ path: `${out}/${viewport.name}-dashboard.png`, fullPage: true });

  await page.goto(`${base}/result.html?id=a1&token=t1`, { waitUntil: 'networkidle' });
  await waitForWorkspace(page);
  if ((await page.locator('.result-decision-card h2').textContent())?.trim() !== 'Fix the material risks before wider use.') throw new Error(`${viewport.name} result did not lead with assessment posture`);
  if ((await page.locator('.finding-work-item').count()) !== 4) throw new Error(`${viewport.name} result finding count changed unexpectedly`);
  const openCount = await page.locator('.finding-work-item[open]').count();
  if (openCount !== 1) throw new Error(`${viewport.name} result should disclose only the first priority work item by default; got ${openCount}`);
  if (!(await page.locator('text=View 1 additional finding').count())) throw new Error(`${viewport.name} result did not collapse lower-priority findings`);
  await assertNav(page, `${viewport.name} result`);
  await assertNoOverflow(page, `${viewport.name} result`);
  await page.screenshot({ path: `${out}/${viewport.name}-result.png`, fullPage: true });

  await page.goto(`${base}/assessment.html`, { waitUntil: 'networkidle' });
  await waitForWorkspace(page);
  await page.locator('#agentName').fill('CLARA v2.6');
  await page.locator('#agentType').selectOption({ label: 'Customer support agent' });
  await page.locator('#nextButton').click();
  await page.waitForSelector('#questionStage:not([hidden])');
  if ((await page.locator('#stepCount').textContent())?.trim() !== 'Question 1') throw new Error(`${viewport.name} assessment exposed raw denominator`);
  if ((await page.locator('#assessmentPhaseTrack span').count()) !== 5) throw new Error(`${viewport.name} assessment does not show five human phases`);
  await assertNav(page, `${viewport.name} assessment`);
  await assertNoOverflow(page, `${viewport.name} assessment`);
  await page.screenshot({ path: `${out}/${viewport.name}-assessment.png`, fullPage: true });

  await page.goto(`${base}/control-intelligence.html?projectId=prj_clara`, { waitUntil: 'networkidle' });
  await waitForWorkspace(page);
  await page.waitForSelector('.ci-decision-summary h2');
  if ((await page.locator('.ci-decision-summary h2').textContent())?.trim() !== 'HOLD') throw new Error(`${viewport.name} deployment evidence did not use the server-recorded decision`);
  if (await page.locator('text=Select a project').count()) throw new Error(`${viewport.name} deployment evidence still starts with an empty project selector state`);
  if ((await page.locator('.ci-technical-provenance[open]').count()) !== 0) throw new Error(`${viewport.name} technical provenance should be collapsed by default`);
  await assertNav(page, `${viewport.name} deployment evidence`);
  await assertNoOverflow(page, `${viewport.name} deployment evidence`);
  await page.screenshot({ path: `${out}/${viewport.name}-deployment-evidence.png`, fullPage: true });

  await page.goto(`${base}/inspector.html?assessment=a1`, { waitUntil: 'networkidle' });
  await waitForWorkspace(page);
  await page.waitForSelector('.workspace-agent-command');
  if ((await page.locator('.workspace-agent-identity h2').textContent())?.trim() !== 'CLARA v2.6') throw new Error(`${viewport.name} evidence view lost selected assessment context`);
  if (!(await page.locator('.workspace-status-card strong', { hasText: 'Observed' }).count())) throw new Error(`${viewport.name} evidence class not explicit`);
  await assertNav(page, `${viewport.name} evidence`);
  await assertNoOverflow(page, `${viewport.name} evidence`);
  await page.screenshot({ path: `${out}/${viewport.name}-evidence.png`, fullPage: true });

  await page.goto(`${base}/help.html?from=workspace&projectId=prj_clara`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-primary-navigation]')?.dataset.workspaceNavigation === 'true');
  await assertNav(page, `${viewport.name} signed-in help`);
  await assertNoOverflow(page, `${viewport.name} signed-in help`);
  await page.screenshot({ path: `${out}/${viewport.name}-help.png`, fullPage: true });

  if (errors.length) throw new Error(`${viewport.name} browser console/page errors:\n${errors.join('\n')}`);
  report.push(`${viewport.name}: dashboard/result/assessment/deployment-evidence/evidence/help passed`);
  await context.close();
}

await browser.close();
console.log(report.join('\n'));
console.log('Browser acceptance: PASS');
