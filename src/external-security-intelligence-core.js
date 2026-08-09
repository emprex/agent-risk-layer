import crypto from 'node:crypto';

export const CLAWHUB_CORPUS_ID = 'openclaw-clawhub-security-signals-paper-v1';
export const CLAWHUB_DATASET = 'OpenClaw/clawhub-security-signals';
export const CLAWHUB_SOURCE_REVISION = '69dcbd323c155312fb000ec89ea0b1efdf6a5757';
export const ALLOWED_SPLITS = new Set(['train', 'validation', 'test', 'eval_holdout']);
export const CUSTOMER_VISIBLE_NAMESPACES = new Set(['clawscan_verdict', 'static_reason_code', 'skillspector_category']);

const RAW_CONTENT_FIELDS = new Set([
  'skill_md_content',
  'skill_bundle_content',
  'clawscan_summary',
  'clawscan_context',
]);
const VIRUSTOTAL_PREFIX = 'virustotal_';

function text(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}
function list(value, maxItems = 32, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}
function integer(value, min = 0, max = 1000000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}
function optionalNumber(value, min = 0, max = 100) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, number));
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function assertMitLicenseText(licenseText) {
  const value = String(licenseText ?? '');
  const required = ['MIT License', 'Permission is hereby granted', 'THE SOFTWARE IS PROVIDED'];
  if (!required.every((phrase) => value.includes(phrase))) {
    throw new Error('The supplied upstream licence file does not look like the MIT licence declared by the dataset.');
  }
  return true;
}

export function assertPinnedClawHubRevision(revision) {
  const value = text(revision, 80).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new Error('ClawHub corpus import requires an exact 40-character source revision.');
  }
  return value;
}

export function projectClawHubRecord(row = {}) {
  const sourceRecordId = text(row.id, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceRecordId)) {
    throw new Error('ClawHub row id must be a 64-character hexadecimal digest.');
  }
  const split = text(row.split, 32);
  if (!ALLOWED_SPLITS.has(split)) {
    throw new Error(`Unsupported ClawHub split: ${split || 'missing'}`);
  }
  const clawscanVerdict = text(row.clawscan_verdict, 24).toLowerCase();
  if (!['clean', 'suspicious', 'malicious', 'unknown'].includes(clawscanVerdict)) {
    throw new Error(`Unsupported ClawScan verdict: ${clawscanVerdict || 'missing'}`);
  }

  const inputKeys = Object.keys(row);
  const strippedRawContentFields = inputKeys.filter((key) => RAW_CONTENT_FIELDS.has(key));
  const strippedVirusTotalFields = inputKeys.filter((key) => key.startsWith(VIRUSTOTAL_PREFIX));

  return {
    sourceRecordId,
    split,
    skillSlugSha256: sha256(text(row.skill_slug, 300).toLowerCase()),
    skillVersion: text(row.skill_version, 80),
    clawscanVerdict,
    clawscanConfidence: text(row.clawscan_confidence, 24).toLowerCase() || null,
    clawscanModel: text(row.clawscan_model, 80) || null,
    staticStatus: text(row.static_status, 24).toLowerCase() || null,
    staticFindingCount: integer(row.static_finding_count, 0, 10000),
    staticReasonCodes: list(row.static_reason_codes, 32, 120),
    skillspectorStatus: text(row.skillspector_status, 24).toLowerCase() || null,
    skillspectorScore: optionalNumber(row.skillspector_score, 0, 100),
    skillspectorSeverity: text(row.skillspector_severity, 24).toUpperCase() || null,
    skillspectorIssueCount: integer(row.skillspector_issue_count, 0, 10000),
    skillspectorIssueCodes: list(row.skillspector_issue_codes, 64, 80),
    skillspectorIssueCategories: list(row.skillspector_issue_categories, 32, 120),
    strippedRawContentFieldCount: strippedRawContentFields.length,
    strippedVirusTotalFieldCount: strippedVirusTotalFields.length,
  };
}

export function aggregateClawHubRecord(record, aggregateMap = new Map()) {
  const increment = (namespace, value) => {
    const normalized = text(value, 160);
    if (!normalized) return;
    const key = `${namespace}\u0000${normalized}`;
    aggregateMap.set(key, (aggregateMap.get(key) || 0) + 1);
  };
  increment('clawscan_verdict', record.clawscanVerdict);
  record.staticReasonCodes.forEach((value) => increment('static_reason_code', value));
  record.skillspectorIssueCategories.forEach((value) => increment('skillspector_category', value));
  return aggregateMap;
}

export function serialiseAggregateMap(aggregateMap) {
  return [...aggregateMap.entries()]
    .map(([key, rowCount]) => {
      const [namespace, value] = key.split('\u0000');
      return { namespace, value, rowCount };
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.value.localeCompare(b.value));
}

export function assertBenchmarkPurposeAllowed(split, purpose) {
  const safeSplit = text(split, 32);
  const safePurpose = text(purpose, 40).toLowerCase();
  if (!ALLOWED_SPLITS.has(safeSplit)) throw new Error('Unknown benchmark split.');
  if (safeSplit === 'eval_holdout' && ['train', 'training', 'tune', 'tuning', 'rule-development', 'threshold-selection'].includes(safePurpose)) {
    throw new Error('eval_holdout is reserved for final evaluation and must not be used for training or tuning.');
  }
  return true;
}

export function publicExternalSignal(signal = {}) {
  const namespace = text(signal.namespace, 80);
  if (!CUSTOMER_VISIBLE_NAMESPACES.has(namespace)) return null;
  return {
    namespace,
    value: text(signal.value, 160),
    rowCount: integer(signal.rowCount, 0, 100000000),
    source: 'OpenClaw ClawHub Security Signals',
    evidenceClass: 'external_reference',
    limitation: 'Reference intelligence only. It does not prove that the assessed customer agent has this weakness.',
  };
}

export function containsForbiddenCustomerField(value) {
  const textValue = JSON.stringify(value ?? {}).toLowerCase();
  return textValue.includes('virustotal_') || textValue.includes('skill_md_content') || textValue.includes('skill_bundle_content') || textValue.includes('clawscan_context');
}
