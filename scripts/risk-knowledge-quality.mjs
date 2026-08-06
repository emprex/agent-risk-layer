import crypto from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function digestRecord(entry) {
  const unsigned = { ...entry };
  delete unsigned.content_digest;
  return crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

const MALFORMED = [
  /the valid With/i,
  /the Attempt/i,
  /record e is denied/i,
  /\b[se] remains available\b/i,
  /\b(?:and|or|the|a|an|to|with|record)\s+[a-z]$/i,
];
const PLACEHOLDER = /\$\{[^}]*\}|\{\{[^}]+\}\}|<<[^>]+>>|\b(?:TODO|TBD|FIXME)\b/i;
const MID_WORD_END = /\b[a-z]{1,2}[.!?]$/i;

function completeSentence(value) {
  return typeof value === 'string' && value.trim().length >= 35 && /[.!?…”]$/.test(value.trim());
}

function orphanedLowercase(value) {
  const body = String(value).replace(/^ARL-KB-\d{3}:\s*/, '');
  return /^[a-z]/.test(body);
}

function duplicateCount(entries, selector) {
  const values = entries.map(selector);
  return values.length - new Set(values).size;
}

export function auditRiskKnowledge(asset) {
  const findings = [];
  for (const entry of asset.entries || []) {
    const statements = [
      ['positive_test', entry.check?.positive_test],
      ['negative_test', entry.check?.negative_test],
      ...(entry.solution?.retest_acceptance || []).map((value, index) => [`retest_acceptance[${index}]`, value]),
    ];
    for (const [field, value] of statements) {
      if (!completeSentence(value)) findings.push({ id: entry.id, field, issue: 'incomplete_sentence', value });
      if (MID_WORD_END.test(String(value).trim())) findings.push({ id: entry.id, field, issue: 'truncated_mid_word', value });
      if (orphanedLowercase(value)) findings.push({ id: entry.id, field, issue: 'orphaned_lowercase_fragment', value });
      if (MALFORMED.some((pattern) => pattern.test(String(value)))) findings.push({ id: entry.id, field, issue: 'known_malformed_combination', value });
      if (PLACEHOLDER.test(String(value))) findings.push({ id: entry.id, field, issue: 'unresolved_placeholder', value });
    }
    for (const [index, value] of (entry.solution?.retest_acceptance || []).entries()) {
      if (!/(?:is no longer reproducible|completes successfully|(?:is|are) denied before|are recorded)/i.test(value)) {
        findings.push({ id: entry.id, field: `retest_acceptance[${index}]`, issue: 'missing_expected_result', value });
      }
    }
    const serialized = JSON.stringify(entry);
    if (PLACEHOLDER.test(serialized)) findings.push({ id: entry.id, field: '*', issue: 'unresolved_placeholder', value: null });
    if (digestRecord(entry) !== entry.content_digest) findings.push({ id: entry.id, field: 'content_digest', issue: 'digest_mismatch', value: null });
  }
  return {
    controlsInspected: asset.entries?.length || 0,
    malformedRecords: new Set(findings.map((finding) => finding.id)).size,
    findings,
    duplicateFieldBlocks: {
      passCondition: duplicateCount(asset.entries, (entry) => entry.check.pass_condition),
      failCondition: duplicateCount(asset.entries, (entry) => entry.check.fail_condition),
      requiredEvidence: duplicateCount(asset.entries, (entry) => JSON.stringify(entry.check.required_evidence)),
      retestAcceptance: duplicateCount(asset.entries, (entry) => JSON.stringify(entry.solution.retest_acceptance)),
    },
    unresolvedPlaceholders: findings.filter((finding) => finding.issue === 'unresolved_placeholder').length,
    digestMismatches: findings.filter((finding) => finding.issue === 'digest_mismatch').length,
  };
}

export function assertRiskKnowledgeQuality(asset) {
  const report = auditRiskKnowledge(asset);
  const duplicateTotal = Object.values(report.duplicateFieldBlocks).reduce((sum, count) => sum + count, 0);
  if (report.findings.length || duplicateTotal) {
    const sample = report.findings.slice(0, 5).map((finding) => `${finding.id}.${finding.field}:${finding.issue}`).join(', ');
    throw new Error(`Risk knowledge semantic quality failed (${report.findings.length} findings, ${duplicateTotal} duplicate blocks): ${sample}`);
  }
  return report;
}
