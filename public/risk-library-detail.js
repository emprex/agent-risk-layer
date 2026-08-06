import { api, escapeHtml, qs } from './shared.js';
import { getSeveritySemantics, severityPresentation } from './risk-knowledge-core.js';

const root = document.querySelector('#riskDetail');
function list(items) { return `<ul>${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`; }
function downloadLink(id, format) { return `/api/risk-knowledge/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`; }
function normalizedPublic(entry) {
  const catalogueSeverity = getSeveritySemantics();
  return {
    ...catalogueSeverity,
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
    <article class="panel risk-detail-section"><h2>Bounded check</h2><h3>Objective</h3><p>${escapeHtml(check.objective || '')}</p><h3>Preconditions</h3>${list(check.preconditions)}<h3>Method</h3><p>${escapeHtml(check.method || '')}</p><h3>Positive test</h3><p>${escapeHtml(check.positiveTest || '')}</p><h3>Negative or abuse test</h3><p>${escapeHtml(check.negativeTest || '')}</p><h3>Identities and inputs</h3>${list(check.requiredIdentities)}${list(check.requiredInputsAndExpectedOutputs)}<h3>Required evidence</h3>${list(check.requiredEvidence)}<h3>Pass criteria</h3><p>${escapeHtml(check.passCondition || '')}</p><h3>Fail criteria</h3><p>${escapeHtml(check.failCondition || '')}</p><h3>Safe-testing constraints</h3>${list(check.safeTestingConstraints)}<h3>Limitations</h3><p class="muted">${escapeHtml(check.limitations || '')}</p></article>
    <article class="panel risk-detail-section"><h2>Containment, remediation and retest</h2><h3>Immediate containment</h3><p>${escapeHtml(solution.immediateContainment || solution.containment || '')}</p><h3>Root-cause remediation</h3><p>${escapeHtml(solution.rootCauseRemediation || solution.recommendedRemediation || '')}</p><h3>Preventive control</h3><p>${escapeHtml(solution.preventiveControl || '')}</p><h3>Monitoring</h3><p>${escapeHtml(solution.monitoring || '')}</p><p><strong>Owner:</strong> ${escapeHtml(solution.defaultOwner || '')}</p><p><strong>Priority:</strong> ${escapeHtml(solution.priority || '')} · <strong>Effort:</strong> ${escapeHtml(metadata.remediationEffort || 'unestimated')}</p><h3>Dependencies</h3>${list(solution.implementationDependencies)}<h3>Rollback</h3><p>${escapeHtml(solution.rollbackConsiderations || '')}</p><h3>Retest requirements</h3><p>${escapeHtml(solution.retestRequirements || '')}</p><h3>Retest acceptance</h3>${list(solution.retestAcceptance)}<h3>Evidence required to close</h3>${list(solution.evidenceRequiredToClose)}</article>
  </section>
  <section class="panel risk-detail-section"><h2>Operational metadata</h2><div class="risk-card-meta"><span>${escapeHtml(metadata.testMode || 'unclassified')} test</span><span>${escapeHtml(metadata.automationStatus || 'unclassified')} automation</span><span>${escapeHtml(metadata.machineRuleStatus || 'no machine rule')}</span><span>${escapeHtml(entry.validation?.status || 'candidate')}</span></div><p>${entry.validation?.status === 'candidate' ? 'Expert-authored candidate content; it has not been represented as customer-exercised, independently reviewed or verified automation.' : escapeHtml(entry.validation?.evidenceReference || '')}</p><h3>Test families</h3>${list(metadata.testFamilies)}<p><strong>Version:</strong> ${escapeHtml(entry.knowledgeVersion || '')}<br><strong>Digest:</strong> ${escapeHtml(entry.contentDigest || '')}</p></section>`;
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
      <section class="panel risk-detail-section"><h2>Problem</h2><p>${escapeHtml(entry.problem?.statement || '')}</p><h3>Why it matters</h3><p>${escapeHtml(entry.problem?.operational_impact || entry.problem?.credible_failure_or_attack || '')}</p><p><strong>${escapeHtml(severityPresentation(entry))}</strong></p><p class="muted">Catalogue controls do not carry a universal severity. AgentRiskLayer assigns severity after evaluating the control against a specific agent’s access, data, authority, exposure, safeguards and potential impact.</p><h3>Applicable architectures</h3>${list(entry.problem?.applicability)}<h3>Assets and trust boundaries</h3>${list(entry.problem?.affected_assets)}<p>${escapeHtml(entry.problem?.trust_boundary || '')}</p></section>
      ${full ? renderFull(entry) : renderPublic(entry)}
      <section class="panel risk-detail-section"><h2>Reference alignment</h2>${renderMappings(entry)}<p class="risk-knowledge-disclaimer">Mappings are informative and do not prove compliance, certification or absence of risk.</p></section>`;
  } catch (error) {
    root.className = 'error-box show';
    root.textContent = error.message;
  }
})();
