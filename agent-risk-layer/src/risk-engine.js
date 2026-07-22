export const questionnaire = [
  {
    id: 'data_sensitivity',
    title: 'What data can the agent access?',
    help: 'Choose the most sensitive data it can read or process.',
    options: [
      { value: 'public', label: 'Public or synthetic data only', points: 0, tags: [] },
      { value: 'internal', label: 'Internal business information', points: 4, tags: ['data'] },
      { value: 'personal', label: 'Personal or customer data', points: 7, tags: ['privacy', 'data'] },
      { value: 'regulated', label: 'Financial, health, legal or regulated data', points: 10, tags: ['regulated', 'privacy', 'data'] },
    ],
  },
  {
    id: 'autonomy',
    title: 'How independently can it act?',
    help: 'Autonomous actions create more impact when something goes wrong.',
    options: [
      { value: 'advice', label: 'It only suggests actions', points: 0, tags: [] },
      { value: 'draft', label: 'It creates drafts for approval', points: 3, tags: ['approval'] },
      { value: 'limited', label: 'It performs limited actions automatically', points: 7, tags: ['autonomy'] },
      { value: 'full', label: 'It acts autonomously across systems', points: 10, tags: ['autonomy', 'approval'] },
    ],
  },
  {
    id: 'permissions',
    title: 'What permission model is used?',
    help: 'Least privilege limits the blast radius of a compromised agent.',
    options: [
      { value: 'scoped', label: 'Dedicated, narrowly scoped permissions', points: 0, tags: [] },
      { value: 'role', label: 'Shared role with moderate permissions', points: 4, tags: ['permissions'] },
      { value: 'user', label: 'Acts with a normal user’s full permissions', points: 7, tags: ['permissions'] },
      { value: 'admin', label: 'Has administrator or owner access', points: 10, tags: ['permissions', 'critical'] },
    ],
  },
  {
    id: 'tools',
    title: 'Which tools or integrations can it call?',
    help: 'External tools, plugins and MCP servers expand the attack surface.',
    options: [
      { value: 'none', label: 'No external tools', points: 0, tags: [] },
      { value: 'approved', label: 'A small allowlist of reviewed tools', points: 3, tags: ['supply-chain'] },
      { value: 'many', label: 'Many third-party tools or MCP servers', points: 7, tags: ['supply-chain', 'mcp'] },
      { value: 'dynamic', label: 'Can discover or install tools dynamically', points: 10, tags: ['supply-chain', 'mcp', 'critical'] },
    ],
  },
  {
    id: 'credentials',
    title: 'How are credentials and secrets handled?',
    help: 'Secrets should never be placed directly in prompts or source code.',
    options: [
      { value: 'vault', label: 'Vaulted, short-lived and scoped', points: 0, tags: [] },
      { value: 'env', label: 'Environment variables with restricted access', points: 3, tags: ['secrets'] },
      { value: 'long-lived', label: 'Long-lived API keys shared by services', points: 7, tags: ['secrets'] },
      { value: 'prompt', label: 'Secrets may appear in prompts, logs or code', points: 10, tags: ['secrets', 'critical'] },
    ],
  },
  {
    id: 'human_approval',
    title: 'Are high-impact actions approved by a human?',
    help: 'Payments, deletion, publishing and permission changes need stronger controls.',
    options: [
      { value: 'always', label: 'Always for high-impact actions', points: 0, tags: [] },
      { value: 'threshold', label: 'Only above defined thresholds', points: 3, tags: ['approval'] },
      { value: 'sometimes', label: 'Approval is informal or inconsistent', points: 7, tags: ['approval'] },
      { value: 'never', label: 'No approval is required', points: 10, tags: ['approval', 'critical'] },
    ],
  },
  {
    id: 'untrusted_input',
    title: 'Can untrusted users or content influence it?',
    help: 'Emails, documents, web pages and user prompts can carry prompt-injection attacks.',
    options: [
      { value: 'isolated', label: 'No untrusted input reaches the agent', points: 0, tags: [] },
      { value: 'filtered', label: 'Input is filtered and treated as untrusted', points: 3, tags: ['prompt-injection'] },
      { value: 'mixed', label: 'Untrusted input is processed with partial controls', points: 7, tags: ['prompt-injection'] },
      { value: 'direct', label: 'Untrusted content directly drives actions', points: 10, tags: ['prompt-injection', 'critical'] },
    ],
  },
  {
    id: 'logging',
    title: 'What audit trail exists?',
    help: 'You need enough evidence to reconstruct what the agent saw, decided and did.',
    options: [
      { value: 'complete', label: 'Tamper-resistant logs with action context', points: 0, tags: [] },
      { value: 'standard', label: 'Standard application logs', points: 3, tags: ['monitoring'] },
      { value: 'partial', label: 'Partial logs without action detail', points: 7, tags: ['monitoring'] },
      { value: 'none', label: 'Little or no logging', points: 10, tags: ['monitoring', 'critical'] },
    ],
  },
  {
    id: 'transactions',
    title: 'Can it move money or create binding commitments?',
    help: 'Financial and contractual actions require strict limits and reconciliation.',
    options: [
      { value: 'no', label: 'No', points: 0, tags: [] },
      { value: 'draft', label: 'It prepares transactions for approval', points: 3, tags: ['financial'] },
      { value: 'capped', label: 'It executes transactions within hard limits', points: 7, tags: ['financial'] },
      { value: 'uncapped', label: 'It can transact without strong limits', points: 10, tags: ['financial', 'critical'] },
    ],
  },
  {
    id: 'network_exposure',
    title: 'How exposed is the agent service?',
    help: 'Public endpoints need authentication, throttling and abuse protection.',
    options: [
      { value: 'private', label: 'Private network only', points: 0, tags: [] },
      { value: 'authenticated', label: 'Public but strongly authenticated', points: 3, tags: ['exposure'] },
      { value: 'partner', label: 'Accessible to partners or broad user groups', points: 7, tags: ['exposure'] },
      { value: 'public', label: 'Open public endpoint with weak controls', points: 10, tags: ['exposure', 'critical'] },
    ],
  },
  {
    id: 'testing',
    title: 'How is the agent tested before changes are released?',
    help: 'Security regression tests should cover prompt injection, tool misuse and unsafe outputs.',
    options: [
      { value: 'gated', label: 'Automated adversarial tests block releases', points: 0, tags: [] },
      { value: 'regular', label: 'Regular manual and automated testing', points: 3, tags: ['testing'] },
      { value: 'occasional', label: 'Occasional testing without release gates', points: 7, tags: ['testing'] },
      { value: 'none', label: 'No structured security testing', points: 10, tags: ['testing', 'critical'] },
    ],
  },
  {
    id: 'kill_switch',
    title: 'Can the agent be stopped quickly?',
    help: 'A tested kill switch and credential revocation path reduce incident impact.',
    options: [
      { value: 'tested', label: 'Tested kill switch and automatic containment', points: 0, tags: [] },
      { value: 'manual', label: 'Documented manual shutdown procedure', points: 3, tags: ['incident-response'] },
      { value: 'slow', label: 'Shutdown depends on several manual steps', points: 7, tags: ['incident-response'] },
      { value: 'none', label: 'No reliable emergency stop', points: 10, tags: ['incident-response', 'critical'] },
    ],
  },
];

const guidance = {
  data: ['Classify the data the agent can access and remove unnecessary datasets.', 'Apply retention limits and redact sensitive fields before model processing.'],
  privacy: ['Complete a privacy impact assessment and document a lawful processing basis.', 'Prevent personal data from being reused for training unless explicitly authorised.'],
  regulated: ['Map regulatory obligations and require specialist review before production use.'],
  autonomy: ['Add action limits, rate limits and maximum-loss boundaries.', 'Separate recommendation generation from action execution.'],
  approval: ['Require explicit approval for payments, deletion, publishing and permission changes.', 'Make approval screens show the exact proposed action and affected resources.'],
  permissions: ['Replace broad credentials with a dedicated least-privilege service identity.', 'Deny high-risk actions by default and allow only named operations.'],
  'supply-chain': ['Maintain an allowlist of reviewed tools and pin integration versions.', 'Verify tool responses before using them as instructions.'],
  mcp: ['Treat every MCP server as a privileged dependency and review its tool schema.', 'Disable dynamic server discovery in production.'],
  secrets: ['Move secrets into a managed vault and issue short-lived credentials.', 'Redact secrets from prompts, traces, analytics and error messages.'],
  'prompt-injection': ['Treat retrieved content as data, never as trusted instructions.', 'Use tool-level policy checks that cannot be overridden by model output.'],
  monitoring: ['Log prompts, tool calls, approvals, outputs and final side effects with correlation IDs.', 'Alert on unusual tool sequences, privilege use and repeated denials.'],
  financial: ['Enforce per-action and daily transaction caps outside the model.', 'Reconcile every transaction against an independent ledger.'],
  exposure: ['Require strong authentication, per-user rate limits and abuse detection.', 'Place the agent behind an API gateway and restrict network egress.'],
  testing: ['Add adversarial regression tests for injection, data leakage and tool misuse.', 'Block deployment when critical safety tests fail.'],
  'incident-response': ['Create and test a one-step kill switch for tools, queues and credentials.', 'Document incident ownership, notification and evidence-preservation steps.'],
  critical: ['Do not deploy this configuration to production until critical controls are closed.'],
};

function band(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

export function evaluateAssessment(answers = {}) {
  const responses = [];
  const tagCounts = new Map();
  let total = 0;

  for (const question of questionnaire) {
    const selected = question.options.find((option) => option.value === answers[question.id]);
    if (!selected) throw new Error(`Missing or invalid answer: ${question.id}`);
    total += selected.points;
    for (const tag of selected.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    responses.push({
      id: question.id,
      title: question.title,
      answer: selected.label,
      points: selected.points,
      severity: selected.points >= 9 ? 'critical' : selected.points >= 7 ? 'high' : selected.points >= 3 ? 'medium' : 'low',
      tags: selected.tags,
    });
  }

  const score = Math.round((total / (questionnaire.length * 10)) * 100);
  const riskBand = band(score);
  const ranked = [...responses].sort((a, b) => b.points - a.points);
  const findings = ranked
    .filter((item) => item.points > 0)
    .map((item, index) => ({
      id: `F-${String(index + 1).padStart(2, '0')}`,
      title: item.title,
      observed: item.answer,
      severity: item.severity,
      points: item.points,
      tags: item.tags,
    }));

  const recommendations = [];
  for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
    for (const recommendation of guidance[tag] || []) {
      if (!recommendations.some((item) => item.text === recommendation)) {
        recommendations.push({ tag, priority: tag === 'critical' ? 'Immediate' : count > 1 ? 'High' : 'Standard', text: recommendation });
      }
    }
  }

  const controls = [
    { name: 'Least-privilege identity', status: answers.permissions === 'scoped' ? 'pass' : 'action' },
    { name: 'Human approval for high-impact actions', status: answers.human_approval === 'always' ? 'pass' : 'action' },
    { name: 'Prompt-injection boundary', status: ['isolated', 'filtered'].includes(answers.untrusted_input) ? 'pass' : 'action' },
    { name: 'Secrets management', status: answers.credentials === 'vault' ? 'pass' : 'action' },
    { name: 'Action audit trail', status: answers.logging === 'complete' ? 'pass' : 'action' },
    { name: 'Emergency containment', status: answers.kill_switch === 'tested' ? 'pass' : 'action' },
    { name: 'Security release gate', status: answers.testing === 'gated' ? 'pass' : 'action' },
  ];

  return {
    score,
    riskBand,
    headline:
      riskBand === 'Low'
        ? 'The agent has a strong control baseline.'
        : riskBand === 'Moderate'
          ? 'The agent needs targeted controls before broader use.'
          : riskBand === 'High'
            ? 'Material weaknesses could lead to data loss or unauthorised actions.'
            : 'Critical weaknesses make production deployment unsafe.',
    findings,
    topFindings: findings.slice(0, 3),
    recommendations,
    controls,
    responses,
    methodology: 'Twelve control domains are scored from 0 to 10. The final score is normalised to 100; higher scores indicate greater residual risk.',
  };
}
