export const CLAWHUB_BENCHMARK_SCHEMA = 'arl.clawhub-inspector-benchmark.v1';

export const BENCHMARK_RELEVANT_RULES = new Set([
  'ARL-SEC-001','ARL-SEC-002','ARL-SEC-003',
  'ARL-CICD-003','ARL-CICD-004',
  'ARL-CTR-003','ARL-CTR-004',
  'ARL-MCP-001','ARL-MCP-002','ARL-MCP-003',
  'ARL-AI-001','ARL-AI-003','ARL-AI-004','ARL-AI-005','ARL-AI-006','ARL-AI-007','ARL-AI-008',
  'ARL-DEP-002','ARL-DEP-003',
]);

// Mappings are semantic comparison aids defined before the final holdout run.
// They do not make the external corpus ground truth and they do not change Inspector rules.
export const EXTERNAL_SIGNAL_TO_ARL_RULES = Object.freeze({
  'static:suspicious.dangerous_exec': ['ARL-MCP-001','ARL-AI-001','ARL-DEP-003'],
  'static:suspicious.env_credential_access': ['ARL-SEC-001','ARL-SEC-003','ARL-AI-004'],
  'static:suspicious.exposed_secret_literal': ['ARL-SEC-001','ARL-SEC-002'],
  'static:suspicious.dynamic_code_execution': ['ARL-AI-001','ARL-MCP-001'],
  'static:suspicious.install_untrusted_source': ['ARL-MCP-003','ARL-DEP-002','ARL-DEP-003'],
  'static:suspicious.destructive_delete_command': ['ARL-MCP-001','ARL-AI-001'],
  'static:suspicious.potential_exfiltration': ['ARL-AI-004','ARL-MCP-002'],
  'static:suspicious.insecure_tls_verification': ['ARL-AI-003'],
  'static:suspicious.secret_argv_exposure': ['ARL-SEC-001','ARL-AI-004'],
  'skillspector:Dangerous Code Execution': ['ARL-MCP-001','ARL-AI-001'],
  'skillspector:Supply Chain': ['ARL-MCP-003','ARL-DEP-002','ARL-DEP-003'],
  'skillspector:Privilege Escalation': ['ARL-CTR-003','ARL-CTR-004','ARL-MCP-001'],
  'skillspector:Tool Misuse': ['ARL-MCP-001','ARL-AI-001','ARL-AI-007'],
  'skillspector:Excessive Agency': ['ARL-MCP-001','ARL-MCP-002','ARL-AI-007'],
});

function isPositive(value) {
  return ['suspicious', 'malicious'].includes(String(value || '').trim().toLowerCase());
}

export function benchmarkRelevantRuleIds(findings = []) {
  return [...new Set((findings || [])
    .map((finding) => String(finding?.ruleId || '').trim())
    .filter((ruleId) => BENCHMARK_RELEVANT_RULES.has(ruleId)))].sort();
}

export function externalSignalLabels(row = {}) {
  return {
    clawscan: isPositive(row.clawscan_verdict),
    static: isPositive(row.static_status),
    skillspector: isPositive(row.skillspector_status),
  };
}

export function mappedSignalsForRow(row = {}) {
  const signals = [];
  for (const code of Array.isArray(row.static_reason_codes) ? row.static_reason_codes : []) {
    const key = `static:${String(code || '').trim()}`;
    if (EXTERNAL_SIGNAL_TO_ARL_RULES[key]) signals.push(key);
  }
  for (const category of Array.isArray(row.skillspector_issue_categories) ? row.skillspector_issue_categories : []) {
    const key = `skillspector:${String(category || '').trim()}`;
    if (EXTERNAL_SIGNAL_TO_ARL_RULES[key]) signals.push(key);
  }
  return [...new Set(signals)].sort();
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function pairMetrics(records, key) {
  let bothPositive = 0;
  let arlOnly = 0;
  let externalOnly = 0;
  let bothNonPositive = 0;
  for (const record of records) {
    const arl = record.arlPositive === true;
    const external = record.external[key] === true;
    if (arl && external) bothPositive += 1;
    else if (arl) arlOnly += 1;
    else if (external) externalOnly += 1;
    else bothNonPositive += 1;
  }
  const externalPositive = bothPositive + externalOnly;
  const externalNonPositive = arlOnly + bothNonPositive;
  return {
    bothPositive,
    arlOnly,
    externalOnly,
    bothNonPositive,
    jaccardPositive: ratio(bothPositive, bothPositive + arlOnly + externalOnly),
    arlDetectionRateOnExternalPositive: ratio(bothPositive, externalPositive),
    arlPositiveRateOnExternalNonPositive: ratio(arlOnly, externalNonPositive),
  };
}

export function summariseClawHubBenchmark(records = [], metadata = {}) {
  const valid = records.filter((record) => !record.error);
  const errors = records.length - valid.length;
  const mapped = new Map();
  for (const record of valid) {
    const arlRuleIds = new Set(record.arlRuleIds || []);
    for (const signal of record.mappedSignals || []) {
      const current = mapped.get(signal) || { sourceRows: 0, arlMappedRuleObserved: 0 };
      current.sourceRows += 1;
      const expectedRules = EXTERNAL_SIGNAL_TO_ARL_RULES[signal] || [];
      if (expectedRules.some((ruleId) => arlRuleIds.has(ruleId))) current.arlMappedRuleObserved += 1;
      mapped.set(signal, current);
    }
  }
  const mappedSignals = Object.fromEntries([...mapped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([signal, value]) => [signal, {
    ...value,
    concordance: ratio(value.arlMappedRuleObserved, value.sourceRows),
    mappedArlRules: EXTERNAL_SIGNAL_TO_ARL_RULES[signal],
  }]));

  return {
    schema: CLAWHUB_BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    corpus: metadata.corpus || 'OpenClaw/clawhub-security-signals',
    sourceRevision: metadata.sourceRevision || null,
    sourceFileSha256: metadata.sourceFileSha256 || null,
    split: metadata.split || null,
    inspectorVersion: metadata.inspectorVersion || null,
    inspectorPolicyVersion: metadata.inspectorPolicyVersion || null,
    rowsRequested: records.length,
    rowsEvaluated: valid.length,
    scanErrors: errors,
    arlPositiveRows: valid.filter((record) => record.arlPositive).length,
    externalComparison: {
      clawscan: pairMetrics(valid, 'clawscan'),
      static: pairMetrics(valid, 'static'),
      skillspector: pairMetrics(valid, 'skillspector'),
    },
    mappedSignalConcordance: mappedSignals,
    limitations: [
      'The ClawHub corpus is a sanitized silver-standard research corpus; scanner positives are not human-verified ground truth.',
      'AgentRisk Inspector is a repository/configuration scanner. Reconstructing each ClawHub skill as a temporary artifact is a scope-limited comparison, not a full deployment assessment.',
      'Agreement/disagreement metrics measure signal concordance, not comparative product accuracy or superiority.',
      'VirusTotal-derived fields are intentionally excluded from this commercial benchmark workflow.',
      'Generic repository-hygiene findings are excluded so synthetic temporary directories do not create meaningless positives.',
    ],
  };
}
