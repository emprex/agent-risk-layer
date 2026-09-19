import fs from 'node:fs';
import path from 'node:path';

const KNOWLEDGE_PATH = path.resolve(import.meta.dirname, '../../risk-knowledge/risk-knowledge-v1.json');
const knowledgeAsset = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
const controls = knowledgeAsset.entries;
const byId = new Map(controls.map((control) => [control.id, control]));

export function normalizeControlId(value) {
  const match = String(value ?? '').trim().toUpperCase().match(/^ARL-KB-(\d{1,3})$/);
  if (!match) return null;
  return `ARL-KB-${match[1].padStart(3, '0')}`;
}

export function getControlHelpRecord(value) {
  const controlId = normalizeControlId(value);
  if (!controlId) return null;
  return byId.get(controlId) ?? null;
}

export function listControlLabels({ statusById = {}, query = '' } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  return controls
    .filter((control) => {
      if (!needle) return true;
      return [
        control.id,
        control.title,
        control.category,
        control.problem?.statement,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle));
    })
    .map((control) => ({
      id: control.id,
      title: control.title,
      category: control.category,
      status: statusById[control.id] ?? 'unknown',
    }));
}

export function formatControlLabel(value, status = 'unknown') {
  const control = getControlHelpRecord(value);
  if (!control) return null;
  return `${control.id} — ${control.title} — ${status}`;
}

function bulletLines(values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length ? list.map((value) => `  - ${value}`) : ['  - Not specified in the current knowledge record.'];
}

export function formatControlHelp(value) {
  const control = getControlHelpRecord(value);
  if (!control) return null;

  const applicability = Array.isArray(control.problem?.applicability)
    ? control.problem.applicability.join('; ')
    : (control.applicability ?? 'Requires architecture review.');

  const lines = [
    `${control.id} — ${control.title}`,
    `Category: ${control.category}`,
    `Knowledge version: ${control.knowledge_version ?? knowledgeAsset.asset?.version ?? 'unknown'}`,
    '',
    'What this control checks:',
    `  ${control.problem?.statement ?? 'No problem statement recorded.'}`,
    '',
    'Why it matters:',
    `  ${control.problem?.operational_impact ?? control.problem?.customer_symptom ?? 'See the authoritative control record for impact details.'}`,
    '',
    'When it applies:',
    `  ${applicability || 'Requires architecture review.'}`,
    '',
    'How ARL tests it:',
    `  ${control.check?.method ?? 'No test method recorded.'}`,
    '',
    'Evidence expected:',
    ...bulletLines(control.check?.required_evidence),
    '',
    'Pass criteria:',
    `  ${control.check?.pass_condition ?? 'No pass condition recorded.'}`,
    '',
    'Fail criteria:',
    `  ${control.check?.fail_condition ?? 'No fail condition recorded.'}`,
    '',
    'Remediation:',
    `  ${control.solution?.recommended_remediation ?? 'No remediation recorded.'}`,
    '',
    `Default owner: ${control.solution?.default_owner ?? 'Not specified'}`,
  ];

  return lines.join('\n');
}

export function formatControlList({ statusById = {}, query = '' } = {}) {
  return listControlLabels({ statusById, query })
    .map((control) => `${control.id} — ${control.title} — ${control.status}`)
    .join('\n');
}

export function controlCount() {
  return controls.length;
}
