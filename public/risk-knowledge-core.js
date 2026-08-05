export const ARCHITECTURE_FACT_KEYS = Object.freeze([
  'affects_people_rights_safety_or_regulated_activity','creates_messages_or_logs','generates_files',
  'handles_files_messages_or_browser_data','has_accountable_decisions','has_confidential_context',
  'has_decentralized_ai_adoption','has_enterprise_workspaces','has_multiple_ai_systems','has_multiple_environments',
  'has_multiple_roles','has_runtime_policy','has_stateful_runtime','has_support_or_delegation',
  'interacts_with_people','is_analytics_or_population_data','is_api_integrated','is_assessed','is_consequential',
  'is_containerized','is_control_plane','is_deployable','is_distributed','is_extensible',
  'is_financial_administrative_or_safety_impacting','is_high_value','is_hosted','is_knowledge_or_decision_support',
  'is_metered_or_commercial','is_model_backed','is_multi_tenant','is_multi_user','is_production','is_public',
  'outputs_to_web','performs_high_impact_actions','performs_money_deletion_deployment_or_access_changes',
  'processes_non_public_data','processes_personal_data','queries_data_stores','requires_defensible_evidence',
  'requires_human_approval','supports_high_impact_decisions','uses_changeable_models','uses_code_execution',
  'uses_custom_or_finetuned_model','uses_dynamic_prompts','uses_dynamic_tools','uses_external_content',
  'uses_external_services','uses_filesystem_tools','uses_long_context','uses_mcp','uses_memory',
  'uses_multimodal_input','uses_multiple_agents','uses_multiple_context_sources','uses_multiple_model_providers',
  'uses_network_tools','uses_planning_or_autonomy','uses_rag','uses_self_hosted_or_imported_model',
  'uses_state_changing_tools','uses_text_filters','uses_tools','uses_vector_or_embedding_store',
]);

export function validateArchitectureFacts(facts = {}) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    const error = new Error('Architecture facts must be an object.');
    error.statusCode = 400;
    throw error;
  }
  const allowed = new Set(ARCHITECTURE_FACT_KEYS);
  for (const [key, value] of Object.entries(facts)) {
    if (!allowed.has(key)) {
      const error = new Error(`Unsupported architecture fact: ${key}.`);
      error.statusCode = 400;
      throw error;
    }
    if (![true, false, null].includes(value)) {
      const error = new Error(`Architecture fact ${key} must be true, false or null.`);
      error.statusCode = 400;
      throw error;
    }
  }
  return facts;
}

export const EVIDENCE_STATES = Object.freeze([
  'not_assessed','declared','observed','test_passed','finding_open',
  'remediation_in_progress','retest_passed','risk_accepted','expired',
]);

function normalizeFacts(facts = {}) {
  const out = {};
  for (const [key, value] of Object.entries(facts || {})) {
    out[key] = value === true ? true : value === false ? false : null;
  }
  return out;
}

function evaluatePredicate(predicate, facts) {
  if (predicate.fact === 'always') return { result: true, fact: 'always' };
  const actual = Object.prototype.hasOwnProperty.call(facts, predicate.fact) ? facts[predicate.fact] : null;
  if (actual === null || actual === undefined) return { result: null, fact: predicate.fact };
  if (predicate.operator === 'eq') return { result: actual === predicate.value, fact: predicate.fact };
  if (predicate.operator === 'exists') return { result: actual !== null && actual !== undefined, fact: predicate.fact };
  if (predicate.operator === 'in') return { result: Array.isArray(predicate.value) && predicate.value.includes(actual), fact: predicate.fact };
  return { result: null, fact: predicate.fact };
}

export function evaluateApplicability(entry, rawFacts = {}) {
  const facts = normalizeFacts(rawFacts);
  const profile = entry?.applicabilityProfile || entry?.applicability_profile;
  if (!profile || !Array.isArray(profile.clauses) || !profile.clauses.length) {
    return { status: 'unknown', reason: 'No structured applicability rules are available.', matchedFacts: [], unknownFacts: [] };
  }
  let anyTrue = false;
  let anyUnknown = false;
  const matchedFacts = new Set();
  const unknownFacts = new Set();
  const clauseResults = profile.clauses.map((clause) => {
    if (clause.match === 'manual' || !clause.predicates?.length) {
      anyUnknown = true;
      return { sourceLabel: clause.source_label, result: null };
    }
    const evaluated = clause.predicates.map((p) => evaluatePredicate(p, facts));
    evaluated.forEach((x) => x.result === true ? matchedFacts.add(x.fact) : x.result === null ? unknownFacts.add(x.fact) : null);
    let result;
    if (clause.match === 'all') {
      result = evaluated.some((x) => x.result === false) ? false : evaluated.every((x) => x.result === true) ? true : null;
    } else {
      result = evaluated.some((x) => x.result === true) ? true : evaluated.every((x) => x.result === false) ? false : null;
    }
    if (result === true) anyTrue = true;
    if (result === null) anyUnknown = true;
    return { sourceLabel: clause.source_label, result };
  });
  if (anyTrue) return { status: 'applicable', reason: 'At least one applicability clause matched.', matchedFacts: [...matchedFacts], unknownFacts: [...unknownFacts], clauseResults };
  if (anyUnknown) return { status: 'unknown', reason: 'Required architecture facts are unknown; include this control for review.', matchedFacts: [...matchedFacts], unknownFacts: [...unknownFacts], clauseResults };
  return { status: 'not_applicable', reason: 'Known architecture facts did not match any applicability clause.', matchedFacts: [], unknownFacts: [], clauseResults };
}

const severityWeight = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1, informational: 0 });

export function summarizeEvidenceReadiness(states = []) {
  const summary = {
    total: states.length, applicable: 0, unknown: 0, notApplicable: 0,
    evidenceStates: Object.fromEntries(EVIDENCE_STATES.map((s) => [s, 0])),
    failedCriticalGates: 0, expiredEvidence: 0, openFindings: 0,
    deploymentGate: 'review_required',
  };
  for (const state of states) {
    if (state.applicabilityStatus === 'not_applicable') {
      summary.notApplicable += 1;
      continue;
    }
    if (state.applicabilityStatus === 'applicable') summary.applicable += 1;
    else summary.unknown += 1;
    if (summary.evidenceStates[state.evidenceState] !== undefined) summary.evidenceStates[state.evidenceState] += 1;
    if (state.criticalGateFailed) summary.failedCriticalGates += 1;
    if (state.evidenceState === 'expired') summary.expiredEvidence += 1;
    if (state.evidenceState === 'finding_open') summary.openFindings += 1;
  }
  if (summary.failedCriticalGates > 0) summary.deploymentGate = 'do_not_deploy';
  else if (summary.openFindings > 0 || summary.expiredEvidence > 0) summary.deploymentGate = 'hold';
  else if (summary.unknown > 0 || summary.evidenceStates.not_assessed > 0) summary.deploymentGate = 'review_required';
  else if (summary.applicable > 0 && summary.evidenceStates.retest_passed + summary.evidenceStates.test_passed + summary.evidenceStates.risk_accepted >= summary.applicable) summary.deploymentGate = 'proceed_candidate';
  return summary;
}

export function buildControlManifest(entry) {
  if (!entry) throw new Error('Risk knowledge entry is required.');
  return {
    schema: 'arl.control-manifest.v1',
    generatedAt: new Date().toISOString(),
    entryId: entry.id,
    entryVersion: entry.knowledgeVersion || entry.knowledge_version,
    entryDigest: entry.contentDigest || entry.content_digest,
    category: entry.category,
    title: entry.title,
    applicability: entry.applicabilityProfile || entry.applicability_profile || null,
    test: {
      objective: entry.checks?.[0]?.objective || entry.check?.objective || null,
      method: entry.checks?.[0]?.method || entry.check?.method || null,
      requiredEvidence: entry.checks?.[0]?.requiredEvidence || entry.check?.required_evidence || [],
      passCondition: entry.checks?.[0]?.passCondition || entry.check?.pass_condition || null,
      failCondition: entry.checks?.[0]?.failCondition || entry.check?.fail_condition || null,
    },
    remediation: {
      objective: entry.solutions?.[0]?.controlObjective || entry.solution?.control_objective || null,
      recommendation: entry.solutions?.[0]?.recommendedRemediation || entry.solution?.recommended_remediation || null,
      owner: entry.solutions?.[0]?.defaultOwner || entry.solution?.default_owner || null,
      priority: entry.solutions?.[0]?.priority || entry.solution?.priority || null,
    },
    limitations: entry.claimsBoundary || entry.claims_boundary,
  };
}

function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const s = String(value);
  return /^[A-Za-z0-9_.\/-]+$/.test(s) ? s : JSON.stringify(s);
}

export function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value.map((item) => typeof item === 'object' && item !== null
      ? `${pad}-\n${toYaml(item, indent + 2)}`
      : `${pad}- ${scalar(item)}`).join('\n');
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return entries.map(([key, item]) => {
      if (typeof item === 'object' && item !== null) return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      return `${pad}${key}: ${scalar(item)}`;
    }).join('\n');
  }
  return `${pad}${scalar(value)}`;
}

export function assertRegoExportAllowed(entry) {
  const metadata = entry?.operationalMetadata || entry?.operational_metadata;
  const machineRuleStatus = metadata?.machineRuleStatus || metadata?.machine_rule_status;
  const exportCapabilities = metadata?.exportCapabilities || metadata?.export_capabilities || {};
  if (machineRuleStatus !== 'verified' || exportCapabilities.rego !== true) {
    const error = new Error('OPA/Rego export is unavailable because this control has no verified executable rule and input schema.');
    error.statusCode = 409;
    throw error;
  }
  return true;
}

export function severityRank(value) { return severityWeight[value] ?? -1; }
