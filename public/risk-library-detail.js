import { api, escapeHtml, qs } from './shared.js';

const root = document.querySelector('#riskDetail');
function list(items) { return `<ul>${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`; }
function downloadLink(id, format) { return `/api/risk-knowledge/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`; }
function normalizedPublic(entry) {
  return {
    ...entry,
    knowledgeVersion: entry.knowledgeVersion || entry.knowledge_version,
    claimsBoundary: entry.claimsBoundary || entry.claims_boundary,
    solutionSummary: entry.solutionSummary || (entry.solution_summary ? {
      recommendedRemediation: entry.solution_summary.recommended_remediation,
      defaultOwner: entry.solution_summary.default_owner,
      priority: entry.solution_summary.priority,
    } : null),
    operationalMetadata: entry.operationalMetadata || (entry.operational_summary ? {
      testMode: entry.operational_summary.test_mode,
      testFamilies: entry.operational_summary.test_families,
      automationStatus: entry.operational_summary.automation_status,
      customerValidationStatus: entry.operational_summary.customer_validation_status,
    } : null),
  };
}
async function loadStaticPublic(id) {
  const response = await fetch('/risk-knowledge-public-v1.1.json', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Risk entry not found.');
  const data = await response.json();
  const entry = (data.entries || []).find((item) => item.id === id || item.slug === id);
  if (!entry) throw new Error('Risk entry not found.');
  return normalizedPublic(entry);
}
async function loadEntry(id) {
  try {
    const full = await api(`/api/risk-knowledge/${encodeURIComponent(id)}/detail`);
    if (full?.entry) return { entry: normalizedPublic(full.entry), full: true };
  } catch (error) {
    if (![401, 403, 404].includes(Number(error?.status || error?.statusCode))) {
      // Continue to the public-safe endpoint because older API helpers may not expose status codes.
    }
  }
  try {
    const publicResult = await api(`/api/risk-knowledge/${encodeURIComponent(id)}`);
    if (publicResult?.entry) return { entry: normalizedPublic(publicResult.entry), full: false };
  } catch {
    return { entry: await loadStaticPublic(id), full: false };
  }
  return { entry: await loadStaticPublic(id), full: false };
}
function renderMappings(entry) {
  const mappings = (entry.mappings || []).map((mapping) => `${mapping.framework} ${mapping.reference || mapping.frameworkReference || ''} — ${mapping.mappingLimit || mapping.mapping_limit || 'Informative mapping only.'}`);
  return mappings.length ? list(mappings) : '<p>No framework mappings are published for this entry.</p>';
}
function renderFull(entry) {
  const check = entry.checks?.[0] || {};
  const solution = entry.solutions?.[0] || {};
  const metadata = entry.operationalMetadata || {};
  return `<section class="risk-detail-grid">
    <article class="panel risk-detail-section"><h2>Bounded check</h2><p>${escapeHtml(check.method || '')}</p><h3>Required evidence</h3>${list(check.requiredEvidence)}<h3>Pass condition</h3><p>${escapeHtml(check.passCondition || '')}</p><h3>Fail condition</h3><p>${escapeHtml(check.failCondition || '')}</p><p class="muted">${escapeHtml(check.limitations || '')}</p></article>
    <article class="panel risk-detail-section"><h2>Remediation and retest</h2><p>${escapeHtml(solution.recommendedRemediation || '')}</p><p><strong>Owner:</strong> ${escapeHtml(solution.defaultOwner || '')}</p><p><strong>Priority:</strong> ${escapeHtml(solution.priority || '')} · <strong>Effort:</strong> ${escapeHtml(metadata.remediationEffort || 'unestimated')}</p><h3>Retest acceptance</h3>${list(solution.retestAcceptance)}</article>
  </section>
  <section class="panel risk-detail-section"><h2>Operational metadata</h2><div class="risk-card-meta"><span>${escapeHtml(metadata.testMode || 'unclassified')} test</span><span>${escapeHtml(metadata.automationStatus || 'unclassified')} automation</span><span>${escapeHtml(metadata.machineRuleStatus || 'no machine rule')}</span><span>${escapeHtml(metadata.customerValidationStatus || 'unvalidated')}</span></div><h3>Test families</h3>${list(metadata.testFamilies)}</section>`;
}
function renderPublic(entry) {
  const solution = entry.solutionSummary || {};
  return `<section class="panel risk-detail-section"><h2>Recommended control direction</h2><p>${escapeHtml(solution.recommendedRemediation || 'Detailed remediation guidance is available in the reviewed workflow.')}</p><p><strong>Default owner:</strong> ${escapeHtml(solution.defaultOwner || 'Assign during assessment')} · <strong>Priority:</strong> ${escapeHtml(solution.priority || 'Determine from scope')}</p></section>
  <section class="risk-access-box"><h2>Unlock the exact check and retest criteria</h2><p>Sign in to connect this control to a project, review required evidence, record findings and track remediation through retest.</p><div class="button-row"><a class="button primary" href="/auth.html">Sign in</a><a class="button ghost" href="/assessment.html">Check an agent free</a></div></section>`;
}

(async () => {
  try {
    const id = qs('id');
    if (!id) throw new Error('Risk identifier is missing.');
    const { entry, full } = await loadEntry(id);
    root.className = 'risk-detail-layout';
    const exportActions = full ? `<div class="button-row"><a class="button ghost small" href="${downloadLink(entry.id, 'json')}">Export JSON manifest</a><a class="button ghost small" href="${downloadLink(entry.id, 'yaml')}">Export YAML manifest</a></div>` : '';
    root.innerHTML = `<section class="page-heading risk-knowledge-hero"><span class="eyebrow">${escapeHtml(entry.category)}</span><h1>${escapeHtml(entry.title)}</h1><p>${escapeHtml(entry.claimsBoundary || '')}</p>${exportActions}</section>
      <section class="panel risk-detail-section"><h2>Problem</h2><p>${escapeHtml(entry.problem?.statement || '')}</p><p><strong>Default severity:</strong> ${escapeHtml(entry.problem?.default_severity || '')}</p><h3>Applicability</h3>${list(entry.problem?.applicability)}</section>
      ${full ? renderFull(entry) : renderPublic(entry)}
      <section class="panel risk-detail-section"><h2>Reference alignment</h2>${renderMappings(entry)}<p class="risk-knowledge-disclaimer">Mappings are informative and do not prove compliance, certification or absence of risk.</p></section>`;
  } catch (error) {
    root.className = 'error-box show';
    root.textContent = error.message;
  }
})();
