import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'phase4-hosted-integration-contract-secret-123456789';

const root = path.resolve(import.meta.dirname, '..');
const agentRoot = path.join(root, 'src', 'agent');

function agentModules(directory = agentRoot) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...agentModules(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files.sort();
}

function requestedBindings(fragment) {
  return fragment
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\.\.\./, '').split(':')[0].split('=')[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

test('Phase 4 hosted API loads against the canonical AgentRiskLayer authority', async () => {
  const hostedApi = await import('../src/agent/hosted-agent-api.mjs');
  const controlIntelligenceCore = await import('../src/control-intelligence-core.js');

  assert.equal(typeof hostedApi.handleHostedAgentApi, 'function');
  assert.equal(typeof controlIntelligenceCore.getDerivedDeploymentReadiness, 'function');

  const expectedPaths = [
    '/api/agent/assessment/prepare',
    '/api/agent/assessment/context',
    '/api/agent/assessment/applicability',
    '/api/agent/assessment/bounded-test/prepare',
    '/api/agent/assessment/bounded-test/complete',
    '/api/agent/assessment/conversation',
    '/api/agent/assessment/continue',
    '/api/agent/assessment/remediation/prepare',
    '/api/agent/assessment/remediation/complete',
    '/api/agent/assessment/changed-snapshot',
    '/api/agent/assessment/remediation/applicability',
    '/api/agent/assessment/exact-retest/prepare',
    '/api/agent/assessment/exact-retest/complete',
    '/api/agent/assessment/human-closure',
    '/api/agent/assessment/readiness/record',
    '/api/agent/assessment/report',
    '/api/agent/assessment/report/export'
  ];

  const exportedPaths = Object.entries(hostedApi)
    .filter(([name, value]) => name.endsWith('_PATH') && typeof value === 'string')
    .map(([, value]) => value);

  for (const endpoint of expectedPaths) {
    assert.ok(exportedPaths.includes(endpoint), `Missing hosted Phase 4 endpoint: ${endpoint}`);
  }
});

test('Phase 4 agent dynamic imports request exports that actually exist', async () => {
  const pattern = /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let checkedBindings = 0;

  for (const sourceFile of agentModules()) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const [, bindingFragment, specifier] = match;
      if (!specifier.startsWith('.')) continue;

      const targetPath = path.resolve(path.dirname(sourceFile), specifier);
      assert.ok(
        fs.existsSync(targetPath),
        `${path.relative(root, sourceFile)} dynamically imports missing module ${specifier}`
      );

      const namespace = await import(pathToFileURL(targetPath).href);
      for (const binding of requestedBindings(bindingFragment)) {
        checkedBindings += 1;
        assert.ok(
          Object.prototype.hasOwnProperty.call(namespace, binding),
          `${path.relative(root, sourceFile)} requests ${binding} from ${path.relative(root, targetPath)}, but that export does not exist`
        );
      }
    }
  }

  assert.ok(checkedBindings > 0, 'Expected to validate at least one Phase 4 dynamic import binding');
});

test('deployment readiness is bound to Control Intelligence core, never inferred by the agent', async () => {
  const source = fs.readFileSync(
    path.join(agentRoot, 'tools', 'get-deployment-readiness.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /import\(['"]\.\.\/\.\.\/control-intelligence-core\.js['"]\)/,
    'Hosted readiness must use the canonical Control Intelligence core authority'
  );
  assert.doesNotMatch(
    source,
    /import\(['"]\.\.\/\.\.\/control-intelligence\.js['"]\)[\s\S]*getDerivedDeploymentReadiness/,
    'The agent must not bind derived readiness through the wrong facade'
  );
});

test('hosted bounded completion immediately continues through gated ARL authority', () => {
  const source = fs.readFileSync(
    path.join(agentRoot, 'hosted-agent-api.mjs'),
    'utf8'
  );

  const start = source.indexOf(
    'export async function completeHostedAgentBoundedTest'
  );

  const end = source.indexOf(
    'export async function prepareHostedAgentRemediation',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const boundedCompletion =
    source.slice(start, end);

  assert.match(
    boundedCompletion,
    /persistBoundedRedTeamReservation/
  );

  assert.match(
    boundedCompletion,
    /continueHostedAgentAssessment\s*\(\s*\{/
  );

  assert.match(
    boundedCompletion,
    /workflowExecution:\s*continued\.body\.workflowExecution/
  );

  assert.doesNotMatch(
    boundedCompletion,
    /recordDeploymentDecision/
  );
});


test('hosted read-only conversation cannot invoke workflow execution', async () => {
  const hostedApi =
    await import('../src/agent/hosted-agent-api.mjs');

  for (const command of [
    'needs',
    'findings',
    'remediation',
    'fixed',
    'retest',
    'readiness',
    'status'
  ]) {
    assert.equal(
      hostedApi
        .normaliseHostedReadOnlyConversationCommand(
          command
        ),
      command
    );
  }

  for (const command of [
    'assess',
    'continue',
    'unknown'
  ]) {
    assert.throws(
      () =>
        hostedApi
          .normaliseHostedReadOnlyConversationCommand(
            command
          ),
      (error) =>
        error?.code ===
        'HOSTED_READ_ONLY_CONVERSATION_COMMAND_INVALID'
    );
  }

  const source = fs.readFileSync(
    path.join(agentRoot, 'hosted-agent-api.mjs'),
    'utf8'
  );

  const start = source.indexOf(
    'export async function readHostedAgentAssessmentConversation'
  );
  const end = source.indexOf(
    'export async function continueHostedAgentAssessment',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const readOnlySurface =
    source.slice(start, end);

  assert.match(
    readOnlySurface,
    /resolveHostedWorkflow/
  );
  assert.doesNotMatch(
    readOnlySurface,
    /executeGatedWorkflow/
  );
  assert.doesNotMatch(
    readOnlySurface,
    /executeAuthoritativeArlAction/
  );
  assert.match(
    readOnlySurface,
    /securityStateChanged:\s*false/
  );
  assert.match(
    readOnlySurface,
    /deploymentDecisionWritten:\s*false/
  );
});


test('hosted human review and report paths preserve explicit authority boundaries', () => {
  const source = fs.readFileSync(
    path.join(agentRoot, 'hosted-agent-api.mjs'),
    'utf8'
  );

  const closureStart = source.indexOf(
    'export async function completeHostedAgentHumanClosure'
  );
  const readinessStart = source.indexOf(
    'export async function recordHostedAgentReadinessDecision'
  );
  const reportStart = source.indexOf(
    'export async function getHostedAgentCustomerReport'
  );
  const readOnlyConversationStart = source.indexOf(
    'const HOSTED_READ_ONLY_CONVERSATION_COMMANDS',
    reportStart
  );

  assert.ok(closureStart >= 0);
  assert.ok(readinessStart > closureStart);
  assert.ok(reportStart > readinessStart);
  assert.ok(readOnlyConversationStart > reportStart);

  const closureSurface =
    source.slice(
      closureStart,
      readinessStart
    );

  assert.match(
    closureSurface,
    /confirmFindingClosure === true/
  );
  assert.match(
    closureSurface,
    /completeHostedHumanFindingClosure/
  );
  assert.match(
    closureSurface,
    /deploymentDecisionWritten:\s*false/
  );
  assert.doesNotMatch(
    closureSurface,
    /recordDeploymentDecision/
  );

  const readinessSurface =
    source.slice(
      readinessStart,
      reportStart
    );

  assert.match(
    readinessSurface,
    /confirmRecordCurrentReadiness === true/
  );
  assert.match(
    readinessSurface,
    /recordHostedHumanReadinessDecision/
  );
  assert.doesNotMatch(
    readinessSurface,
    /body\.decision/
  );
  assert.doesNotMatch(
    readinessSurface,
    /body\.deploymentDecision/
  );

  const reportSurface =
    source.slice(
      reportStart,
      readOnlyConversationStart
    );

  assert.match(
    reportSurface,
    /buildHostedCustomerAssessmentReport/
  );
  assert.match(
    reportSurface,
    /readOnly:\s*true/
  );
  assert.match(
    reportSurface,
    /securityStateChanged:\s*false/
  );
  assert.match(
    reportSurface,
    /deploymentDecisionWritten:\s*false/
  );

  const continueStart = source.indexOf(
    'export async function continueHostedAgentAssessment'
  );
  const handleStart = source.indexOf(
    'export async function handleHostedAgentApi',
    continueStart
  );
  assert.ok(continueStart >= 0);
  assert.ok(handleStart > continueStart);

  const continueSurface =
    source.slice(
      continueStart,
      handleStart
    );

  assert.doesNotMatch(
    continueSurface,
    /completeHostedHumanFindingClosure/
  );
  assert.doesNotMatch(
    continueSurface,
    /recordHostedHumanReadinessDecision/
  );
  assert.doesNotMatch(
    continueSurface,
    /buildHostedCustomerAssessmentReport/
  );
});


test('hosted report rendering and export remain read-only product projections', () => {
  const apiSource = fs.readFileSync(
    path.join(agentRoot, 'hosted-agent-api.mjs'),
    'utf8'
  );
  const humanReviewSource = fs.readFileSync(
    path.join(agentRoot, 'hosted-human-review.mjs'),
    'utf8'
  );

  const reportStart = apiSource.indexOf(
    'export async function getHostedAgentCustomerReport'
  );
  const exportStart = apiSource.indexOf(
    'export async function getHostedAgentCustomerReportDeliverable'
  );
  const readOnlyStart = apiSource.indexOf(
    'const HOSTED_READ_ONLY_CONVERSATION_COMMANDS',
    exportStart
  );

  assert.ok(reportStart >= 0);
  assert.ok(exportStart > reportStart);
  assert.ok(readOnlyStart > exportStart);

  const reportSurface = apiSource.slice(
    reportStart,
    exportStart
  );
  const exportSurface = apiSource.slice(
    exportStart,
    readOnlyStart
  );

  assert.match(
    reportSurface,
    /renderHostedCustomerAssessmentReport/
  );
  assert.match(
    reportSurface,
    /readOnly:\s*true/
  );
  assert.match(
    reportSurface,
    /securityStateChanged:\s*false/
  );
  assert.match(
    reportSurface,
    /deploymentDecisionWritten:\s*false/
  );

  assert.match(
    exportSurface,
    /buildHostedCustomerAssessmentDeliverable/
  );
  assert.match(
    exportSurface,
    /deliverable:/
  );
  assert.match(
    exportSurface,
    /readOnly:\s*true/
  );
  assert.match(
    exportSurface,
    /securityStateChanged:\s*false/
  );
  assert.match(
    exportSurface,
    /deploymentDecisionWritten:\s*false/
  );
  assert.doesNotMatch(
    exportSurface,
    /writeCustomerAssessmentDeliverable/
  );

  assert.match(
    humanReviewSource,
    /buildCustomerAssessmentDeliverable/
  );
  assert.match(
    humanReviewSource,
    /renderCustomerAssessmentReport/
  );
});

test('hosted human review routes reject caller-supplied authority fields', () => {
  const source = fs.readFileSync(
    path.join(agentRoot, 'hosted-agent-api.mjs'),
    'utf8'
  );

  for (const field of [
    'userId',
    'projectId',
    'assessmentId',
    'workspaceId',
    'systemSnapshotId',
    'findingId',
    'controlId',
    'caseId',
    'baselineRunId',
    'retestRunId',
    'severity',
    'readiness',
    'decision',
    'deploymentDecision'
  ]) {
    assert.match(
      source,
      new RegExp(
        `['"]${field}['"]`
      )
    );
  }

  assert.match(
    source,
    /HOSTED_HUMAN_REVIEW_AUTHORITY_FIELD_REJECTED/
  );
});
