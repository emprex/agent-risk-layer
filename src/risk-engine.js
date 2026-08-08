const EVIDENCE = {
  none: { label: 'No evidence supplied', score: 0, multiplier: 1.18, verified: false },
  customer_assertion: { label: 'Customer assertion — not verified', score: 20, multiplier: 1.12, verified: false },
  evidence_ready: { label: 'Supporting evidence ready — not yet linked or reviewed', score: 20, multiplier: 1.12, verified: false },
  configuration_observed: { label: 'Configuration observed', score: 55, multiplier: 1.04, verified: false },
  artifact_uploaded: { label: 'Artifact uploaded — review pending', score: 60, multiplier: 1.02, verified: false },
  automatically_tested: { label: 'Automatically tested', score: 85, multiplier: 0.96, verified: true },
  expert_verified: { label: 'Expert verified', score: 95, multiplier: 0.93, verified: true },
  independently_reviewed: { label: 'Independently reviewed', score: 100, multiplier: 0.92, verified: true },
};

const option = (value, label, points, tags = []) => ({ value, label, points, tags });
const na = (value, label) => option(value, label, 0, ['not-applicable']);

const baseQuestionnaire = [
  { id: 'data_sensitivity', domain: 'Data protection', kind: 'exposure', title: 'What is the most sensitive data the agent can access?', help: 'Classify the highest sensitivity level actually available to the agent today.', options: [option('public', 'Public or synthetic data only', 0), option('internal', 'Internal business information', 4, ['data']), option('personal', 'Personal, customer or confidential data', 7, ['data', 'privacy']), option('regulated', 'Financial, health, legal, authentication or regulated data', 10, ['data', 'privacy', 'regulated'])] },
  { id: 'autonomy', domain: 'Autonomy', kind: 'exposure', title: 'How independently can the agent act?', help: 'Autonomous execution increases the blast radius of an unsafe decision.', options: [option('advice', 'It only recommends actions', 0), option('draft', 'It prepares drafts for approval', 3, ['approval']), option('limited', 'It performs limited actions automatically', 7, ['autonomy']), option('full', 'It plans and executes across systems autonomously', 10, ['autonomy', 'critical'])] },
  { id: 'transactions', domain: 'High-impact actions', kind: 'exposure', title: 'Can it move money, delete data, publish content or create binding commitments?', help: 'Include financial, legal, access-control and irreversible operational actions.', options: [option('none', 'No high-impact actions', 0), option('draft', 'It prepares them for human approval', 3, ['high-impact', 'approval']), option('bounded', 'It executes within enforced limits', 7, ['high-impact']), option('unbounded', 'It can execute with weak or no hard limits', 10, ['high-impact', 'critical'])] },
  { id: 'network_exposure', domain: 'Attack surface', kind: 'exposure', title: 'Who can directly interact with the agent?', help: 'Classify direct users here. Documents, retrieval and other indirect inputs are assessed separately.', options: [option('private', 'Private, tightly controlled users', 0), option('workforce', 'Authenticated workforce users', 3, ['exposure']), option('partners', 'Partners, customers or broad user groups', 7, ['exposure']), option('public', 'Open public access or anonymous users', 10, ['exposure', 'critical'])] },
  { id: 'external_content', domain: 'Prompt injection', kind: 'exposure', title: 'Does it process untrusted documents, email, web pages or retrieved content?', help: 'Indirect prompt injection commonly enters through data that appears legitimate.', options: [option('none', 'No external or untrusted content', 0), option('curated', 'Only curated, trusted sources', 3, ['prompt-injection']), option('mixed', 'A mix of trusted and untrusted sources', 7, ['prompt-injection']), option('open', 'Open web, inboxes, uploads or arbitrary retrieval', 10, ['prompt-injection', 'critical'])] },
  { id: 'tool_scope', domain: 'Tool security', kind: 'exposure', title: 'What can connected tools or MCP servers do?', help: 'Focus on write access, command execution and access to sensitive systems.', options: [option('none', 'No tools, or read-only low-risk tools', 0), option('narrow', 'Small allowlist with narrow write actions', 3, ['tools']), option('broad', 'Multiple tools with broad business access', 7, ['tools', 'mcp']), option('privileged', 'Admin, shell, code execution or dynamic tool discovery', 10, ['tools', 'mcp', 'critical'])] },
  { id: 'multi_agent', domain: 'Agent relationships', kind: 'exposure', title: 'Can this agent delegate to or receive instructions from other agents?', help: 'Delegation chains can propagate untrusted instructions and authority.', options: [option('none', 'No multi-agent communication', 0), option('fixed', 'Fixed, authenticated agent relationships', 3, ['multi-agent']), option('several', 'Several agents with shared context or tools', 7, ['multi-agent']), option('dynamic', 'Dynamic delegation or untrusted agent discovery', 10, ['multi-agent', 'critical'])] },
  { id: 'business_impact', domain: 'Business impact', kind: 'exposure', title: 'What is the maximum credible business impact if the agent behaves incorrectly?', help: 'Now consider the access and authority above: customer harm, financial loss, operational interruption and legal exposure.', options: [option('minor', 'Minor inconvenience with easy recovery', 0), option('material', 'Material internal disruption or rework', 4, ['impact']), option('major', 'Customer harm, major loss or reportable incident', 7, ['impact', 'high-impact']), option('severe', 'Severe financial, legal, safety or systemic harm', 10, ['impact', 'high-impact', 'critical'])] },

  { id: 'permissions', domain: 'Identity and access', kind: 'control', title: 'How are agent permissions constrained?', help: 'Use a dedicated identity and grant only the operations required for the task.', options: [option('scoped', 'Dedicated identity with least privilege and explicit deny rules', 0), option('role', 'Dedicated role but permissions are broader than necessary', 4, ['permissions']), option('user', 'Shared user/service credentials or broad inherited access', 7, ['permissions']), option('admin', 'Administrator, owner or wildcard permissions', 10, ['permissions', 'critical']), na('not-applicable', 'Not applicable — the agent has no external system permissions')] },
  { id: 'credentials', domain: 'Secrets', kind: 'control', title: 'How are credentials issued and protected?', help: 'Long-lived secrets increase persistence and lateral-movement risk.', options: [option('jit', 'Vaulted, short-lived, scoped and automatically rotated', 0), option('vault', 'Vaulted but long-lived or manually rotated', 3, ['secrets']), option('env', 'Static environment secrets shared across services', 7, ['secrets']), option('exposed', 'Secrets may appear in prompts, code, logs or memory', 10, ['secrets', 'critical']), na('not-used', 'Not applicable — this agent uses no credentials or secrets')] },
  { id: 'tool_authorization', domain: 'Tool security', kind: 'control', title: 'What independently authorises each tool action?', help: 'The model must not be the final authority for its own permissions.', options: [option('policy', 'Deterministic policy engine checks user, action, resource and context', 0), option('allowlist', 'Tool allowlist with basic parameter validation', 3, ['tools']), option('prompt', 'Prompt instructions are the main restriction', 7, ['tools']), option('none', 'No independent authorisation boundary', 10, ['tools', 'critical']), na('not-applicable', 'Not applicable — this agent has no executable tools')] },
  { id: 'human_approval', domain: 'Human oversight', kind: 'control', title: 'How are high-impact actions approved?', help: 'Approval should bind the exact action, target, value/parameters and validity period.', options: [option('bound', 'Transaction-bound approval for every high-impact action', 0), option('threshold', 'Enforced approval above clear thresholds', 3, ['approval']), option('informal', 'Informal or inconsistent review', 7, ['approval']), option('none', 'No human approval requirement', 10, ['approval', 'critical']), na('not-applicable', 'Not applicable — this agent cannot perform high-impact actions')] },
  { id: 'input_boundary', domain: 'Prompt injection', kind: 'control', title: 'How is untrusted content separated from trusted instructions?', help: 'User and retrieved content should remain data/context, not executable authority.', options: [option('strong', 'Trusted/untrusted separation plus deterministic policy checks', 0), option('filtered', 'Filtering, delimiters and source labelling', 3, ['prompt-injection']), option('prompt-only', 'Prompt wording is the primary defence', 7, ['prompt-injection']), option('none', 'Untrusted content can directly influence actions', 10, ['prompt-injection', 'critical'])] },
  { id: 'output_validation', domain: 'Output safety', kind: 'control', title: 'How are model outputs validated before use?', help: 'Validate structure, destination, content and policy before an output can execute, publish or change persistent state.', options: [option('schema', 'Strict schema, business-rule and destination validation', 0), option('partial', 'Schema validation for some actions', 3, ['output']), option('manual', 'Ad hoc checks or manual review only', 7, ['output']), option('none', 'Outputs are executed or published directly', 10, ['output', 'critical']), na('display-only', 'Not applicable — outputs are display-only and cannot execute or persist changes')] },
  { id: 'memory_security', domain: 'Memory and context', kind: 'control', title: 'How is memory isolated and protected?', help: 'Persistent memory should be separated between users/sessions, validated before storage and traceable to its source.', options: [option('isolated', 'Per-tenant isolation, validation, provenance and retention limits', 0), option('segmented', 'Basic user/session separation and retention controls', 3, ['memory']), option('shared', 'Shared or weakly separated memory/context', 7, ['memory']), option('uncontrolled', 'Unvalidated persistent memory with sensitive data', 10, ['memory', 'critical']), na('not-applicable', 'Not applicable — there is no persistent or cross-session memory')] },
  { id: 'data_minimisation', domain: 'Data protection', kind: 'control', title: 'Is sensitive data minimised before model processing?', help: 'Only the minimum necessary data should enter prompts, memory and traces.', options: [option('strong', 'Classification, redaction, field-level minimisation and retention limits', 0), option('partial', 'Some redaction and retention controls', 3, ['data', 'privacy']), option('broad', 'Broad datasets are sent with limited minimisation', 7, ['data', 'privacy']), option('none', 'Sensitive data is copied freely into prompts, memory or logs', 10, ['data', 'privacy', 'critical'])] },
  { id: 'egress_control', domain: 'Network security', kind: 'control', title: 'How is outbound network access controlled?', help: 'Restrict destinations, protocols, payloads and download behaviour.', options: [option('deny', 'Default-deny egress with explicit destination allowlists', 0), option('proxy', 'Controlled proxy with monitoring and domain restrictions', 3, ['egress']), option('broad', 'Broad internet access with limited filtering', 7, ['egress']), option('open', 'Unrestricted outbound access or arbitrary downloads', 10, ['egress', 'critical']), na('not-applicable', 'Not applicable — the agent has no outbound network access')] },
  { id: 'supply_chain', domain: 'Supply chain', kind: 'control', title: 'How are models, tools, packages and MCP servers governed?', help: 'Inventory, provenance, signing and version pinning reduce dependency risk.', options: [option('governed', 'Approved inventory, provenance checks, pinning and change review', 0), option('inventory', 'Inventory and partial version controls', 3, ['supply-chain']), option('informal', 'Informal review and floating versions', 7, ['supply-chain']), option('dynamic', 'Unreviewed or dynamically installed components', 10, ['supply-chain', 'critical'])] },
  { id: 'logging', domain: 'Observability', kind: 'control', title: 'Can you reconstruct what the agent saw, decided and changed?', help: 'Logs should link identity, input source, relevant context, model/system version, action, approval and side effect.', options: [option('complete', 'Tamper-resistant, correlated decision and action logs', 0), option('standard', 'Good application and tool logs but incomplete decision context', 3, ['monitoring']), option('partial', 'Partial logs with gaps in inputs, approvals or effects', 7, ['monitoring']), option('none', 'Little or no reliable audit trail', 10, ['monitoring', 'critical'])] },
  { id: 'detection', domain: 'Detection and response', kind: 'control', title: 'Are unsafe patterns detected in near real time?', help: 'Detect unusual tool chains, repeated denials, exfiltration, runaway loops and material behaviour drift.', options: [option('active', 'Behaviour baselines, alerts and automated containment', 0), option('alerts', 'Rule-based alerts with an on-call response', 3, ['monitoring']), option('review', 'Periodic manual log review', 7, ['monitoring']), option('none', 'No agent-specific monitoring or alerting', 10, ['monitoring', 'critical'])] },
  { id: 'cost_limits', domain: 'Resource abuse', kind: 'control', title: 'Are token, retry, recursion and spend limits enforced outside the model?', help: 'Hard limits prevent denial-of-wallet and runaway execution.', options: [option('hard', 'Per-run, per-user and daily hard limits with circuit breakers', 0), option('some', 'Some caps and timeouts', 3, ['resource']), option('soft', 'Soft warnings or prompt-based limits', 7, ['resource']), option('none', 'Unlimited loops, retries, tool chains or spend', 10, ['resource', 'critical'])] },
  { id: 'testing', domain: 'Security assurance', kind: 'control', title: 'What adversarial testing blocks unsafe releases?', help: 'Test direct/indirect injection, tool misuse, leakage, memory poisoning, authority manipulation and abuse cases.', options: [option('gated', 'Automated adversarial suite and release gates', 0), option('regular', 'Regular manual and automated testing without full gates', 3, ['testing']), option('occasional', 'Occasional testing after major changes', 7, ['testing']), option('none', 'No structured agent-security testing', 10, ['testing', 'critical'])] },
  { id: 'change_management', domain: 'Lifecycle governance', kind: 'control', title: 'What changes trigger security review and reassessment?', help: 'Models, prompts, tools, permissions, data sources, memory architecture, learned behaviour and hosting can all change risk.', options: [option('gated', 'Material changes require review, tests and signed approval', 0), option('tracked', 'Changes are tracked with periodic reassessment', 3, ['governance']), option('informal', 'Reviews depend on individual judgement', 7, ['governance']), option('none', 'No defined security change gate', 10, ['governance', 'critical'])] },
  { id: 'kill_switch', domain: 'Incident response', kind: 'control', title: 'Can the agent be contained quickly and safely?', help: 'Containment should stop execution, revoke credentials, block tools and freeze relevant persistent state without model cooperation.', options: [option('tested', 'One-step tested containment with credential/tool revocation and state preservation', 0), option('manual', 'Documented manual shutdown tested periodically', 3, ['incident-response']), option('slow', 'Several manual steps with unclear ownership', 7, ['incident-response']), option('none', 'No reliable emergency stop', 10, ['incident-response', 'critical'])] },
  { id: 'ownership', domain: 'Governance', kind: 'control', title: 'Is one accountable owner responsible for this agent?', help: 'One accountable owner should accept risk and approve material changes, while technical and operational duties can be assigned to others.', options: [option('clear', 'One named accountable owner with documented technical and operational responsibilities', 0), option('single', 'A named owner but incomplete responsibilities', 3, ['governance']), option('shared', 'Shared or ambiguous accountability', 7, ['governance']), option('none', 'No accountable owner', 10, ['governance', 'critical'])] },
];

export const questionnaire = baseQuestionnaire.map((question) => ({
  ...question,
  options: [...question.options, option('unknown', "I'm not sure", 0, ['uncertainty'])],
}));

export const evidenceOptions = ['none', 'customer_assertion', 'evidence_ready'].map((value) => ({ value, label: EVIDENCE[value].label }));

const guidance = {
  permissions: ['Create a dedicated non-human identity and remove inherited or wildcard permissions.', 'Enforce resource-level deny rules outside the model.'],
  secrets: ['Move credentials to a managed vault and issue short-lived, task-scoped tokens.', 'Scan prompts, traces, memory and logs for secret leakage.'],
  tools: ['Put every tool call behind deterministic authorisation and parameter validation.', 'Maintain a reviewed tool allowlist and disable unreviewed dynamic discovery in production.'],
  approval: ['Require transaction-bound approval for high-impact actions.', 'Bind approval to the exact target, action, parameters/value and validity period.'],
  'prompt-injection': ['Treat retrieved and user-supplied content as untrusted data, never authority.', 'Separate trusted instructions from content and enforce policy at the action boundary.'],
  output: ['Require schema, destination, business-rule and policy validation before executable or persistent use.'],
  memory: ['Isolate memory by tenant/user/session; validate writes and retain provenance.', 'Support expiry, correction, deletion and recovery from poisoned state.'],
  data: ['Minimise and redact sensitive fields before model processing.', 'Apply purpose limits, retention controls and access logging.'],
  privacy: ['Document processing purposes, retention and deletion for personal or customer data.'],
  egress: ['Adopt default-deny network egress with explicit destinations and payload controls.'],
  'supply-chain': ['Inventory and pin models, packages, tools and MCP servers; verify provenance before release.'],
  monitoring: ['Correlate inputs, relevant context, model decisions, actions, approvals and side effects.', 'Alert on denied actions, unusual sequences, exfiltration indicators, runaway loops and material drift.'],
  resource: ['Enforce hard token, time, recursion, retry and spend limits outside the model.'],
  testing: ['Add adversarial regression tests for injection, leakage, tool misuse, memory poisoning, authority manipulation and unsafe delegation.', 'Block release when critical abuse cases fail.'],
  governance: ['Assign one accountable owner, document responsibilities and define reassessment triggers.'],
  'incident-response': ['Implement and exercise containment that stops execution, revokes authority and preserves/freeze relevant state for investigation.'],
  critical: ['Do not deploy or expand a configuration with a confirmed critical weakness until it is remediated and retested.'],
};

const frameworks = {
  permissions: ['OWASP Agentic: Excessive Agency', 'NIST AI RMF MANAGE 2'],
  tools: ['OWASP Agentic: Tool Misuse', 'OWASP Agent Security - Tool Security'],
  approval: ['OWASP Agent Security - Human-in-the-Loop'],
  'prompt-injection': ['OWASP LLM01 Prompt Injection', 'OWASP Agentic: Agent Goal Hijack'],
  memory: ['OWASP Agentic: Memory Poisoning'],
  data: ['NIST AI RMF MAP 2', 'NIST AI 600-1 Data Privacy'],
  monitoring: ['NIST AI RMF MEASURE 2', 'OWASP Agent Security - Monitoring'],
  testing: ['NIST AI RMF MEASURE 2.7', 'OWASP Secure Agent Testing'],
  'supply-chain': ['OWASP LLM03 Supply Chain'],
  resource: ['OWASP LLM10 Unbounded Consumption'],
  'incident-response': ['NIST AI RMF MANAGE 4'],
  governance: ['NIST AI RMF GOVERN'],
  egress: ['OWASP Agentic: Data Exfiltration'],
  secrets: ['OWASP Agent Security - Secrets'],
  output: ['OWASP LLM05 Improper Output Handling'],
  'multi-agent': ['OWASP Agent Security - Multi-Agent Security'],
  uncertainty: ['NIST AI RMF MEASURE 2'],
};

const clarification = {
  data_sensitivity: ['Data sensitivity determines the impact of leakage or misuse.', 'List the data stores/fields the agent can actually read or receive.', 'A reviewed data-flow or access inventory for this agent.'],
  autonomy: ['Execution authority determines how quickly a bad decision can become a real-world event.', 'Confirm whether the agent only advises, drafts, or can execute without confirmation.', 'Architecture/configuration showing the execution boundary, plus a negative test if it acts.'],
  transactions: ['High-impact actions require stronger authorisation and approval.', 'List any ability to move money, delete/change data, publish, change access or create commitments.', 'Tool/action inventory and a controlled execution/denial test.'],
  network_exposure: ['Direct access determines who can intentionally or accidentally influence the agent.', 'Identify who can use the UI/API and how they authenticate.', 'Access-control configuration or an authenticated access test.'],
  external_content: ['Untrusted content can carry indirect prompt injection.', 'List documents, uploads, email, web, retrieval or other external content the agent consumes.', 'Data-flow/source inventory plus an injection test for applicable sources.'],
  tool_scope: ['Tool authority defines the agent’s practical blast radius.', 'List connected tools/functions/MCP servers and their read/write/admin capabilities.', 'A current tool inventory and scoped permission/configuration evidence.'],
  multi_agent: ['Delegation can propagate instructions and authority across agents.', 'Confirm whether this agent sends work to or accepts work/context from other agents.', 'Agent relationship/configuration map and authentication evidence.'],
  business_impact: ['Business impact is needed to set meaningful severity after access and authority are understood.', 'Identify the worst credible consequence if the agent is wrong or compromised.', 'Owner-reviewed impact statement tied to the exact deployment scope.'],
  permissions: ['Permissions determine which resources a compromised agent can reach.', 'Identify the runtime identity and its effective permissions.', 'Current permission export or a repeatable allow/deny test.'],
  credentials: ['Credential handling affects persistence and lateral movement.', 'List credentials/tokens used and how they are scoped, stored and rotated.', 'Vault/identity configuration and a secret-leakage check.'],
  tool_authorization: ['The model should not grant itself authority to use tools.', 'Identify the independent enforcement layer between model output and tool execution.', 'Policy/allowlist configuration plus a denied-action test.'],
  human_approval: ['High-impact approvals must match the exact action that executes.', 'Describe which actions require approval and what target/parameters/value/expiry are bound.', 'A test showing changed or replayed approval parameters are rejected.'],
  input_boundary: ['Untrusted text should not become trusted authority, including after memory or retrieval.', 'Describe how user/retrieved content is labelled, separated and policy-checked.', 'Boundary/policy configuration plus direct and indirect injection tests.'],
  output_validation: ['Malformed or unsafe model output can become dangerous when executed, published or persisted.', 'Describe validation before outputs can reach tools, users or persistent state.', 'Schema/business-rule checks plus a negative malformed-output test.'],
  memory_security: ['Persistent memory can leak data or preserve attacker influence across sessions.', 'Explain isolation, write validation, provenance, correction/deletion and retention.', 'Memory architecture plus cross-session leakage and memory-poisoning tests.'],
  data_minimisation: ['Unnecessary sensitive data increases privacy and exfiltration impact.', 'Identify what enters prompts, memory, logs and traces and what is removed first.', 'Reviewed data-flow, redaction/minimisation settings and retention evidence.'],
  egress_control: ['Outbound access can turn read access into an exfiltration path.', 'List allowed outbound destinations/protocols and how they are enforced.', 'Network policy/proxy configuration plus a denied-destination test.'],
  supply_chain: ['Unreviewed model/package/tool changes can alter behaviour and trust assumptions.', 'List model/package/tool versions and how updates/provenance are controlled.', 'Pinned inventory, digests/signatures where applicable and change-review evidence.'],
  logging: ['Without correlated evidence, incidents and behaviour changes cannot be reconstructed reliably.', 'Confirm what inputs, context, version, decisions, actions, approvals and state changes are logged.', 'A trace from one repeatable test showing the full decision/action chain.'],
  detection: ['Detection is needed to catch unsafe behaviour that appears after deployment or adaptation.', 'Describe alerts/containment for denied actions, abnormal sequences, exfiltration, loops and drift.', 'Alert evidence from a repeatable unsafe-behaviour test.'],
  cost_limits: ['Runaway reasoning/retries can cause denial-of-wallet or availability loss.', 'Confirm hard external limits for tokens, time, retries, recursion and spend.', 'Runtime configuration and a test that hits a limit and fails closed.'],
  testing: ['Security testing only protects releases when failures have defined consequences.', 'List adversarial cases, cadence and which failures block release.', 'Dated test results and release-gate evidence.'],
  change_management: ['Evidence can become stale after code, model, permission, memory or learned-behaviour changes.', 'Define material-change triggers and who requires targeted retesting.', 'Change policy plus a sample change/reassessment record.'],
  kill_switch: ['Containment must work without relying on a misbehaving model to cooperate.', 'Describe how execution, tools, credentials and persistent/learned state are stopped or frozen.', 'Timed containment exercise with preserved audit evidence and recovery steps.'],
  ownership: ['Security decisions need an accountable person who can accept risk and coordinate response.', 'Name the accountable owner and document approval/change/incident duties.', 'Ownership record or policy tied to this agent.'],
};

const findingDetails = {
  permissions: ['Excessive or shared permissions can turn model compromise into broad system access.', 'Constrain the agent to a dedicated least-privilege identity with explicit resource/action boundaries.', 'A current permission export or repeatable test proving denied resources/actions stay denied.'],
  credentials: ['Long-lived, shared or exposed credentials can enable persistent unauthorised access.', 'Use scoped, protected credentials and remove secrets from prompts, memory, logs and source.', 'Vault/identity configuration plus rotation and leakage tests.'],
  tool_authorization: ['Without an independent action boundary, manipulated model output can directly reach tools.', 'Authorise every tool call outside the model and validate action, target, parameters and context.', 'Policy configuration plus a controlled denied-action test.'],
  human_approval: ['Weak or reusable approval can authorise a different high-impact action than the human intended.', 'Bind approval to the exact action, target, parameters/value and a short validity/replay boundary.', 'A negative test showing changed, expired and replayed approvals are rejected.'],
  input_boundary: ['Untrusted content may redirect reasoning or actions if it is treated as authority.', 'Keep user/retrieved content explicitly untrusted and enforce policy independently at action boundaries.', 'Direct/indirect injection tests showing content cannot override a denied action.'],
  output_validation: ['Unsafe or malformed model output can become an executable or persistent side effect.', 'Validate schema, destination, content and business/security policy before use.', 'Malformed/forbidden output tests that are rejected before side effects.'],
  memory_security: ['Weak persistent-memory controls can enable cross-user leakage or long-lived attacker influence.', 'Isolate memory, validate writes, retain provenance and support expiry/correction/deletion/recovery.', 'Cross-session isolation and memory-poisoning/recovery tests.'],
  data_minimisation: ['Sending unnecessary sensitive data to models, memory or logs increases privacy and leakage impact.', 'Minimise/redact sensitive fields and enforce purpose, access and retention limits.', 'Reviewed data flow, minimisation configuration and retention/deletion evidence.'],
  egress_control: ['Broad outbound connectivity can provide a route for data exfiltration or unsafe downloads.', 'Restrict outbound destinations/protocols and monitor payload/download behaviour.', 'Network policy plus a controlled denied-destination test.'],
  supply_chain: ['Floating or unreviewed dependencies can silently change agent behaviour or introduce malicious capability.', 'Maintain an approved inventory, pin versions and verify provenance before release.', 'Version inventory/digests and a reviewed dependency-change record.'],
  logging: ['Incomplete audit context makes it difficult to reconstruct unsafe decisions or prove what changed.', 'Correlate identity, inputs, relevant context, versions, decisions, actions, approvals and side effects.', 'A complete trace from a repeatable end-to-end test.'],
  detection: ['Without timely detection, unsafe behaviour can continue until a user notices the damage.', 'Add agent-specific alerts and containment for denied actions, abnormal behaviour, exfiltration and loops.', 'Alert/containment evidence from a repeatable unsafe-action test.'],
  cost_limits: ['Soft or absent limits can allow runaway reasoning, retries or spend.', 'Enforce hard token/time/retry/recursion/spend limits outside the model.', 'A controlled limit-exhaustion test showing deterministic termination.'],
  testing: ['Ungated security testing can allow known unsafe behaviour into a release.', 'Run repeatable adversarial regression tests and define failures that block release.', 'Dated regression output and release-gate evidence.'],
  change_management: ['Security evidence can become stale after material system or learned-state changes.', 'Define material-change triggers, invalidate stale evidence and require targeted retesting/approval.', 'A change record showing evidence invalidation, retest and decision.'],
  kill_switch: ['Slow or unreliable containment can allow an incident to continue or recur after restart.', 'Provide tested containment that stops authority and preserves/freezes relevant state for recovery.', 'A timed containment and known-good recovery/retest exercise.'],
  ownership: ['Ambiguous accountability can delay risk acceptance, remediation and incident decisions.', 'Assign one accountable owner and document technical/operational responsibilities.', 'An ownership record tied to the assessed agent and deployment.'],
};

function band(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function severity(points) {
  return points >= 9 ? 'critical' : points >= 7 ? 'high' : points >= 4 ? 'medium' : 'low';
}

function normaliseAnswer(raw) {
  const answer = typeof raw === 'string'
    ? { value: raw, evidence: 'customer_assertion' }
    : { value: raw?.value, evidence: raw?.evidence || 'none' };
  if (['claimed', 'documented', 'tested'].includes(answer.evidence)) answer.evidence = 'customer_assertion';
  return answer;
}

function uniq(items) { return [...new Set(items.filter(Boolean))]; }

function attackPaths(answers) {
  const val = (id) => normaliseAnswer(answers[id]).value;
  const paths = [];
  const add = (condition, title, narrative, level, tags) => {
    if (condition) paths.push({ id: `AP-${String(paths.length + 1).padStart(2, '0')}`, title, narrative, severity: level, tags, frameworks: uniq(tags.flatMap((tag) => frameworks[tag] || [])) });
  };
  add(['mixed', 'open'].includes(val('external_content')) && ['prompt-only', 'none'].includes(val('input_boundary')) && ['broad', 'privileged'].includes(val('tool_scope')), 'Indirect prompt injection to privileged tool execution', 'Untrusted content can influence an agent with broad tool authority without a strong policy boundary. A malicious document, message or web page could redirect the agent into unauthorised actions.', 'critical', ['prompt-injection', 'tools']);
  add(['full', 'limited'].includes(val('autonomy')) && ['none', 'informal'].includes(val('human_approval')) && ['bounded', 'unbounded'].includes(val('transactions')), 'Autonomous high-impact action without transaction-bound approval', 'The agent can execute consequential actions while approval is absent or weak. A model error, compromised context or malicious instruction could become an immediate business event.', 'critical', ['approval', 'high-impact']);
  add(['admin', 'user'].includes(val('permissions')) && ['exposed', 'env'].includes(val('credentials')), 'Credential compromise with excessive blast radius', 'Broad privileges combined with static or exposed credentials create a durable path to lateral movement and high-impact system access.', 'critical', ['permissions', 'secrets']);
  add(['shared', 'uncontrolled'].includes(val('memory_security')) && ['personal', 'regulated'].includes(val('data_sensitivity')), 'Cross-user data leakage or persistent memory poisoning', 'Sensitive information is processed alongside weakly isolated persistent memory, increasing the chance of cross-session disclosure and long-lived malicious instructions.', 'high', ['memory', 'data']);
  add(['open', 'broad'].includes(val('egress_control')) && ['personal', 'regulated'].includes(val('data_sensitivity')), 'Sensitive-data exfiltration through outbound channels', 'The agent can access sensitive data and communicate broadly outbound, creating a route for accidental or adversarial exfiltration.', 'critical', ['egress', 'data']);
  add(val('supply_chain') === 'dynamic' || val('multi_agent') === 'dynamic', 'Untrusted dependency or agent joins the execution chain', 'Dynamic components or relationships can introduce new instructions and capabilities without review, provenance or stable security assumptions.', 'high', ['supply-chain', 'multi-agent']);
  add(['none', 'soft'].includes(val('cost_limits')) && ['full', 'limited'].includes(val('autonomy')), 'Runaway loop and denial-of-wallet', 'Autonomous execution without hard resource limits can create unbounded token spend, recursive tool use or sustained service degradation.', 'high', ['resource']);
  return paths;
}

export function evaluateAssessment(answers = {}, context = {}) {
  const responses = [];
  let exposureTotal = 0;
  let exposureMax = 0;
  let controlTotal = 0;
  let controlMax = 0;
  let evidenceTotal = 0;
  let knownAnswerCount = 0;

  for (const q of questionnaire) {
    const supplied = normaliseAnswer(answers[q.id]);
    const selected = q.options.find((item) => item.value === supplied.value);
    if (!selected) throw new Error(`Missing or invalid answer: ${q.id}`);
    const ev = EVIDENCE[supplied.evidence] || EVIDENCE.none;
    const isUnknown = selected.value === 'unknown';
    const isNotApplicable = selected.tags.includes('not-applicable');
    const adjusted = isUnknown || isNotApplicable ? 0 : Math.min(10, selected.points * ev.multiplier);

    if (!isUnknown) {
      knownAnswerCount += 1;
      if (q.kind === 'exposure') {
        exposureTotal += selected.points;
        exposureMax += 10;
      } else if (!isNotApplicable) {
        controlTotal += adjusted;
        controlMax += 10;
      }
    }
    evidenceTotal += ev.score;
    responses.push({
      id: q.id,
      domain: q.domain,
      kind: q.kind,
      title: q.title,
      answer: selected.label,
      value: selected.value,
      rawPoints: selected.points,
      points: Math.round(adjusted * 10) / 10,
      severity: isUnknown || isNotApplicable ? null : severity(adjusted),
      tags: selected.tags,
      evidence: supplied.evidence,
      evidenceLabel: ev.label,
      evidenceScore: ev.score,
      unknown: isUnknown,
      notApplicable: isNotApplicable,
    });
  }

  const inherentRisk = exposureMax ? Math.round((exposureTotal / exposureMax) * 100) : null;
  const controlGap = controlMax ? Math.round((controlTotal / controlMax) * 100) : null;
  const evidenceConfidence = Math.round(evidenceTotal / questionnaire.length);
  const assessmentCompleteness = Math.round((knownAnswerCount / questionnaire.length) * 100);
  const scoreAvailable = inherentRisk !== null && controlGap !== null;
  const score = scoreAvailable ? Math.min(100, Math.round(inherentRisk * 0.38 + controlGap * 0.62)) : 0;
  const aggregateRiskBand = scoreAvailable ? band(score) : 'Undetermined';

  const unresolvedItems = responses.filter((response) => response.unknown).map((response, index) => {
    const detail = clarification[response.id] || ['This information is needed to complete the assessment.', 'Confirm the current state with the system owner.', 'A reviewed configuration or repeatable test.'];
    return {
      id: `U-${String(index + 1).padStart(2, '0')}`,
      questionId: response.id,
      domain: response.domain,
      title: response.title,
      status: 'information-required',
      observed: response.answer,
      whyItMatters: detail[0],
      whatToConfirm: detail[1],
      proof: detail[2],
      frameworks: frameworks.uncertainty,
    };
  });

  const ranked = responses
    .filter((response) => response.kind === 'control' && !response.unknown && !response.notApplicable && response.points > 0)
    .sort((a, b) => b.points - a.points || a.evidenceScore - b.evidenceScore);

  const findings = ranked.map((response, index) => {
    const detail = findingDetails[response.id] || ['The declared control weakness increases security risk.', 'Implement and test an appropriate control.', 'A reviewed configuration plus a repeatable negative test.'];
    return {
      id: `F-${String(index + 1).padStart(2, '0')}`,
      title: response.title,
      domain: response.domain,
      observed: response.answer,
      severity: response.severity,
      points: response.points,
      evidence: response.evidenceLabel,
      evidenceScore: response.evidenceScore,
      tags: response.tags,
      impact: detail[0],
      recommendation: detail[1],
      verification: detail[2],
      frameworks: uniq(response.tags.flatMap((tag) => frameworks[tag] || [])),
    };
  });

  const recommendations = [];
  for (const finding of findings) {
    for (const tag of finding.tags || []) {
      for (const text of guidance[tag] || []) {
        if (!recommendations.some((item) => item.text === text)) {
          recommendations.push({ tag, priority: finding.severity === 'critical' ? 'Immediate' : finding.severity === 'high' ? 'High' : 'Standard', text, frameworks: frameworks[tag] || [] });
        }
      }
    }
  }

  const paths = attackPaths(answers);
  const controls = questionnaire.filter((question) => question.kind === 'control').map((question) => {
    const response = responses.find((item) => item.id === question.id);
    const verified = Boolean(EVIDENCE[response.evidence]?.verified);
    let status = 'action';
    if (response.unknown) status = 'unresolved';
    else if (response.notApplicable) status = verified ? 'not-applicable-verified' : 'not-applicable-declared';
    else if (response.rawPoints === 0) status = verified ? 'verified' : 'evidence-required';
    return {
      name: question.title,
      domain: question.domain,
      status,
      applicability: response.notApplicable ? 'not-applicable-claimed' : 'applicable-or-unknown',
      answer: response.answer,
      evidenceState: response.evidence,
      evidence: response.evidenceLabel,
      verified,
    };
  });

  const blockingEvidenceGaps = controls.filter((control) => ['evidence-required', 'not-applicable-declared'].includes(control.status));
  const hasCriticalAttackPath = paths.some((path) => path.severity === 'critical');
  const hasCriticalFinding = findings.some((finding) => finding.severity === 'critical');
  const hasHighAttackPath = paths.some((path) => path.severity === 'high');
  const hasHighFinding = findings.some((finding) => finding.severity === 'high');
  const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
  const highestSeverity = (items) => items.reduce((highest, item) => (severityRank[item.severity] || 0) > (severityRank[highest] || 0) ? item.severity : highest, '');
  const highestFindingSeverity = highestSeverity(findings);
  const highestAttackPathSeverity = highestSeverity(paths);
  const highestMaterialSeverity = (severityRank[highestFindingSeverity] || 0) >= (severityRank[highestAttackPathSeverity] || 0) ? highestFindingSeverity : highestAttackPathSeverity;
  const severityBand = { low: 'Low', medium: 'Moderate', high: 'High', critical: 'Critical' }[highestMaterialSeverity] || 'Undetermined';
  const bandRank = { Undetermined: -1, Low: 0, Moderate: 1, High: 2, Critical: 3 };
  const riskBand = scoreAvailable
    ? (bandRank[severityBand] > bandRank[aggregateRiskBand] ? severityBand : aggregateRiskBand)
    : (severityBand !== 'Undetermined' ? severityBand : 'Undetermined');

  let decision;
  if (hasCriticalAttackPath || hasCriticalFinding) decision = 'DO NOT DEPLOY';
  else if (scoreAvailable && score >= 75) decision = 'DO NOT DEPLOY';
  else if ((scoreAvailable && score >= 50) || hasHighFinding || hasHighAttackPath) decision = unresolvedItems.length ? 'HOLD FOR INFORMATION AND REMEDIATION' : 'DEPLOY ONLY AFTER MATERIAL REMEDIATION';
  else if (unresolvedItems.length && (findings.length || paths.length)) decision = 'HOLD FOR INFORMATION AND REMEDIATION';
  else if (unresolvedItems.length) decision = 'HOLD FOR INFORMATION';
  else if (blockingEvidenceGaps.length) decision = 'HOLD FOR EVIDENCE';
  else if ((scoreAvailable && score >= 25) || findings.length || paths.length) decision = 'PROCEED WITH CONDITIONS';
  else decision = 'PROCEED WITH MONITORING';

  const headline = decision === 'HOLD FOR INFORMATION AND REMEDIATION'
    ? `${unresolvedItems.length} material security question${unresolvedItems.length === 1 ? '' : 's'} remain unresolved, while ${findings.length} declared control weakness${findings.length === 1 ? '' : 'es'} and ${paths.length} credible attack-path concern${paths.length === 1 ? '' : 's'} also require review. Complete the missing information and remediate the confirmed weaknesses before relying on a deployment decision.`
    : decision === 'HOLD FOR INFORMATION'
      ? `${unresolvedItems.length} material security questions remain unresolved. No vulnerability is inferred from unanswered questions; complete the missing information before relying on this assessment for deployment.`
      : decision === 'HOLD FOR EVIDENCE'
        ? 'The declared controls need tested or reviewed evidence before this assessment can support a deployment decision.'
        : decision === 'DO NOT DEPLOY'
          ? 'A declared critical weakness or credible critical attack path must be remediated and retested before production use.'
          : riskBand === 'Low'
            ? 'The declared risk is low, subject to the verified evidence and stated scope.'
            : riskBand === 'Moderate'
              ? 'Targeted weaknesses should be closed before broader deployment.'
              : 'Material control gaps should be closed before wider use.';

  const systemDescription = String(answers.__system_description || context.systemDescription || '').trim().slice(0, 800);
  const methodology = 'This assessment separates exposure, declared controls, unresolved information and evidence confidence. Unknown answers are not scored as vulnerabilities and do not create findings. Exposure describes potential consequence, not a weakness by itself. Findings represent declared control weaknesses or separately observed/tested failures. The overall declared risk band never falls below the highest declared finding or credible attack-path severity, while the numerical score remains an aggregate. A HOLD may be issued when material information, remediation or evidence is missing.';

  return {
    score,
    scoreAvailable,
    riskBand,
    aggregateRiskBand,
    highestFindingSeverity,
    highestAttackPathSeverity,
    highestMaterialSeverity,
    inherentRisk,
    controlGap,
    evidenceConfidence,
    assessmentCompleteness,
    knownAnswerCount,
    unansweredCount: unresolvedItems.length,
    decision,
    headline,
    blockingInformationGaps: unresolvedItems,
    blockingEvidenceGaps,
    unresolvedItems,
    topUnresolved: unresolvedItems.slice(0, 5),
    findings,
    topFindings: findings.slice(0, 3),
    attackPaths: paths,
    recommendations,
    controls,
    responses,
    agentType: context.agentType || '',
    systemDescription,
    methodology,
    frameworkSummary: {
      owasp: uniq(findings.flatMap((finding) => finding.frameworks).filter((item) => item.startsWith('OWASP'))),
      nist: uniq([...findings.flatMap((finding) => finding.frameworks), ...unresolvedItems.flatMap((item) => item.frameworks)].filter((item) => item.startsWith('NIST'))),
    },
    scoring: { inherentRisk, controlGap, evidenceConfidence, assessmentCompleteness, scoreAvailable, aggregateRiskBand, highestFindingSeverity, highestAttackPathSeverity, highestMaterialSeverity, unansweredCount: unresolvedItems.length, uncertaintyPenalty: 0 },
  };
}
