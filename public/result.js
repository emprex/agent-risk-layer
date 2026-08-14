import { api, escapeHtml, qs, riskClass, setBusy } from './shared.js';
import { assessmentRemediationHref } from './assessment-remediation.js';

const root = document.querySelector('#resultRoot');
const id = qs('id');
const token = qs('token');
let assessment;
let questionnaire = [];
let user;
let isOwner = false;
let revisionSource = null;

async function init() {
  if (!id || !token) return fail('The assessment link is incomplete.');
  try {
    const [assessmentPayload, userPayload, questionnairePayload] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`),
      api('/api/auth/me'),
      api('/api/questionnaire').catch(() => ({ questionnaire: [] })),
    ]);
    assessment = assessmentPayload.assessment;
    isOwner = assessmentPayload.isOwner;
    revisionSource = assessmentPayload.revisionSource || null;
    user = userPayload.user;
    questionnaire = questionnairePayload.questionnaire || [];
    if (isOwner) sessionStorage.setItem('arl_selected_assessment', assessment.id);
    render();
  } catch (error) {
    fail(error.message);
  }
}

function metric(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

function unresolvedCountFromHeadline(full) {
  const text = String(full?.headline || assessment?.headline || '');
  const match = text.match(/(\d+)\s+material security questions? remain unresolved/i);
  return match ? Number(match[1]) : 0;
}

function deriveUnresolved(full) {
  const exact = full.unresolvedItems || full.blockingInformationGaps;
  if (Array.isArray(exact) && exact.length) return { items: exact, count: exact.length, exact: true };
  const controls = assessment.controls || full.controls || [];
  const controlItems = controls
    .filter((control) => control.status === 'unresolved')
    .map((control, index) => ({
      id: `U-${String(index + 1).padStart(2, '0')}`,
      title: control.name,
      whyItMatters: 'This protection cannot be relied on until the current implementation is understood.',
      whatToConfirm: 'Confirm the current control with the system owner and record what is true today.',
      proof: 'A reviewed configuration, architecture record or repeatable test for this exact agent.',
    }));
  const total = Math.max(unresolvedCountFromHeadline(full), controlItems.length);
  const otherCount = Math.max(0, total - controlItems.length);
  if (otherCount) {
    controlItems.unshift({
      id: 'Context',
      title: `${otherCount} exposure or architecture question${otherCount === 1 ? '' : 's'} also need an answer`,
      whyItMatters: 'Data, users, autonomy, tools and business impact determine which protections and tests are actually required.',
      whatToConfirm: 'Return to the system owner and complete the unanswered context questions before treating the risk score as meaningful.',
      proof: 'An owner-reviewed architecture/data-flow description for the assessed deployment.',
    });
  }
  return { items: controlItems, count: total, exact: otherCount === 0 };
}

function deriveCompleteness(full, unresolvedCount) {
  if (Number.isFinite(Number(full.assessmentCompleteness))) return Number(full.assessmentCompleteness);
  const total = questionnaire.length;
  if (!total || !unresolvedCount) return unresolvedCount ? null : 100;
  return Math.max(0, Math.round(((total - unresolvedCount) / total) * 100));
}

function revisionHref() {
  if (!revisionSource) return '/assessment.html';
  const params = new URLSearchParams({ updateFrom: revisionSource.assessmentId });
  if (token && !isOwner) params.set('token', token);
  return `/assessment.html?${params.toString()}`;
}

function severityLabel(value) {
  const text = String(value || '').toLowerCase();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'None';
}

function controlStatusText(control) {
  const evidence = control.evidence || 'Evidence not stated';
  if (control.status === 'unresolved') return 'Information required';
  if (control.status === 'not-applicable-verified') return 'Not applicable — verified';
  if (control.status === 'not-applicable-declared' || control.applicability === 'not-applicable-claimed') return 'Not applicable — declared, not verified';
  if (control.status === 'verified') return `Verified · ${evidence}`;
  if (control.status === 'action') return `Action required · ${evidence}`;
  return `Evidence required · ${evidence}`;
}

function primaryAction({ unresolvedCount, findings, paid }) {
  if (unresolvedCount) return {
    href: revisionSource ? revisionHref() : '/assessment.html',
    label: revisionSource ? 'Update missing information' : 'Run an updated assessment',
    title: 'Confirm the missing security information',
    detail: 'Unknown information is not a vulnerability, but it prevents a defensible assessment posture until the current state is confirmed.',
  };
  if (findings.length) return {
    href: paid ? assessmentRemediationHref({ assessmentId: assessment.id, token, isOwner }) : '#priorityRisks',
    label: paid ? 'Start remediation' : 'Open highest-priority finding',
    title: findings[0].title,
    detail: paid ? 'Assign the fix, record implementation evidence and retest the same risk before closure.' : 'Review what was declared, what could happen and what evidence would be needed to prove the fix.',
  };
  if (isOwner) return {
    href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}`,
    label: 'Add observed evidence',
    title: 'Strengthen the assessment with technical evidence',
    detail: 'No declared weakness was established from answered questions. That is not a security approval; observed or test-generated evidence can strengthen the conclusion.',
  };
  return { href: '/assessment.html', label: 'Assess another agent', title: 'Keep the scope current', detail: 'Reassess after material changes to tools, permissions, data, models or autonomy.' };
}

function render() {
  const full = assessment.result || {};
  const paid = assessment.paidTier !== 'free';
  const unresolvedState = deriveUnresolved(full);
  const unresolved = unresolvedState.items;
  const unresolvedCount = unresolvedState.count;
  const rawFindings = paid ? (full.findings || []) : (assessment.topFindings || full.topFindings || full.findings || []);
  const findings = rawFindings.filter((item) => item.status !== 'information-required' && item.kind !== 'information-required');
  const decision = plainDecision(full.decision, unresolvedCount, findings.length);
  const scoreAvailable = full.scoreAvailable !== false && assessment.riskBand !== 'Undetermined';
  const completeness = deriveCompleteness(full, unresolvedCount);
  const controls = assessment.controls || full.controls || [];
  const action = primaryAction({ unresolvedCount, findings, paid });
  const highest = severityLabel(full.highestFindingSeverity);
  const evidenceConfidence = metric(full.evidenceConfidence ?? 0, '%');
  const dashboardHref = isOwner ? `/dashboard.html?assessment=${encodeURIComponent(assessment.id)}` : '/dashboard.html';

  root.className = 'result-workspace';
  root.innerHTML = `
    <header class="result-agent-header">
      <div><span class="eyebrow">Assessment · ${escapeHtml(assessment.paidTier === 'free' ? 'free check' : 'security assessment')}</span><h1>${escapeHtml(assessment.name)}</h1><p>${escapeHtml(assessment.agentType)} · assessed ${assessment.createdAt ? new Date(assessment.createdAt).toLocaleDateString('en-GB') : 'current record'}</p></div>
      <div class="workspace-page-actions">${isOwner ? `<a class="button ghost small" href="${dashboardHref}">Back to agent</a>` : ''}${revisionSource ? `<a class="button ghost small" href="${revisionHref()}">Update answers</a>` : ''}</div>
    </header>

    <section class="result-decision-card" data-state="${escapeHtml(decision.state)}" id="summary">
      <span class="eyebrow">Current assessment posture</span>
      <h2>${escapeHtml(decision.title)}</h2>
      <p>${escapeHtml(decision.explanation)}</p>
      <div class="result-reason-grid" aria-label="Why this is the current posture">
        <div><strong>${findings.length}</strong><span>declared finding${findings.length === 1 ? '' : 's'}</span></div>
        <div><strong>${unresolvedCount}</strong><span>information gap${unresolvedCount === 1 ? '' : 's'}</span></div>
        <div><strong>${escapeHtml(highest)}</strong><span>highest declared finding</span></div>
        <div><strong>${escapeHtml(evidenceConfidence)}</strong><span>evidence confidence</span></div>
      </div>
      <div class="result-next-action"><div><span class="eyebrow">Next action</span><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.detail)}</p></div><a class="button primary" href="${action.href}">${escapeHtml(action.label)}</a></div>
    </section>

    <nav class="workspace-local-nav" data-local-navigation aria-label="Assessment result views"><a href="#summary" aria-current="page">Summary</a><a href="#priorityRisks">Findings</a>${unresolvedCount ? '<a href="#informationNeeded">Information gaps</a>' : ''}${paid ? '<a href="#actionPlan">Fixes</a>' : ''}<a href="#evidenceDetails">Evidence</a></nav>

    <div class="result-body-grid">
      <section>
        ${unresolvedCount ? `<section class="workspace-section" id="informationNeeded"><div class="workspace-section-heading"><div><span class="eyebrow">Information gaps</span><h2>${unresolvedCount} question${unresolvedCount === 1 ? '' : 's'} still need confirmation</h2><p>These are unresolved assessment inputs, not discovered vulnerabilities.</p></div></div>${workItemList(unresolved, unresolvedWorkItem, 'information item')}${!unresolvedState.exact ? '<p class="microcopy">This result shows the unresolved control questions available in the summary plus the remaining context count.</p>' : ''}</section>` : ''}

        <section class="workspace-section" id="priorityRisks"><div class="workspace-section-heading"><div><span class="eyebrow">Findings from declared answers</span><h2>${findings.length ? 'Highest-priority weaknesses' : 'No declared weakness established'}</h2><p>${findings.length ? 'These findings come from specific answers. They remain unverified until linked to reviewed evidence or repeatable tests.' : 'Unknown answers are kept separate from vulnerabilities. This result is not a security approval.'}</p></div></div>${findings.length ? workItemList(findings, findingWorkItem, 'finding') : '<div class="success-box"><strong>No control weakness was established from the answered questions.</strong><p>Missing information, unobserved implementation and untested runtime behaviour can still limit assurance.</p></div>'}</section>

        ${paid ? remediationHtml(full) : ''}

        <details class="workspace-technical" id="evidenceDetails"><summary><span>Technical score, controls and evidence</span><small>Open security/audit detail</small></summary><div class="workspace-technical-body">
          <div class="metric-grid section-gap"><div class="metric-card"><span>Aggregate declared score</span><strong>${scoreAvailable ? `${assessment.score}/100` : 'Not determined'}</strong></div><div class="metric-card"><span>Overall declared risk band</span><strong>${scoreAvailable ? escapeHtml(assessment.riskBand) : 'Not determined'}</strong></div><div class="metric-card"><span>Highest declared finding</span><strong>${escapeHtml(highest)}</strong></div><div class="metric-card"><span>Exposure</span><strong>${metric(full.inherentRisk, full.inherentRisk === null ? '' : '/100')}</strong></div><div class="metric-card"><span>Control gap</span><strong>${metric(full.controlGap, full.controlGap === null ? '' : '/100')}</strong></div><div class="metric-card"><span>Security information completeness</span><strong>${completeness === null ? '—' : `${completeness}%`}</strong></div><div class="metric-card"><span>Evidence confidence</span><strong>${escapeHtml(evidenceConfidence)}</strong></div></div>
          <p class="microcopy">${escapeHtml(full.methodology || assessment.methodology || '')}</p><h3>Protection status</h3><div class="control-grid">${controls.map((control) => `<div class="control ${escapeHtml(control.status)}">${escapeHtml(control.name)}<small class="evidence-chip">${escapeHtml(controlStatusText(control))}</small></div>`).join('')}</div>${paid && full.attackPaths?.length ? `<h3 class="section-gap">Credible attack paths</h3>${full.attackPaths.map(pathHtml).join('')}` : ''}${technicalEvidenceHtml(full, paid)}
        </div></details>
      </section>

      <aside class="workspace-section result-side-panel"><span class="eyebrow">Assessment scope</span><h3>${escapeHtml(assessment.name)}</h3><p class="muted">${escapeHtml(assessment.agentType)}</p>${full.systemDescription ? `<p>${escapeHtml(full.systemDescription)}</p>` : ''}<div class="result-side-risk">${scoreAvailable ? `<span class="risk-pill ${riskClass(assessment.riskBand)}">${escapeHtml(assessment.riskBand)} declared band</span><strong>${assessment.score}<small>/100 aggregate</small></strong>` : '<span class="risk-pill">Security information incomplete</span><strong>—</strong>'}</div><p class="microcopy">The aggregate score summarises breadth and uncertainty. It is not a probability of breach and does not downgrade a more severe individual finding.</p>
        ${paid ? `<a class="button primary" href="/api/reports/${encodeURIComponent(assessment.id)}/pdf?token=${encodeURIComponent(token)}">Download PDF report</a>` : `<button class="button primary" id="buyPro">Get Security Assessment · £99</button><p class="microcopy">The £99 assessment unlocks the full report, remediation and retest workflows. It does not claim inspection, testing or human review unless corresponding evidence exists.</p>`}
        ${isOwner ? `<a class="button ghost" href="/inspector.html?assessment=${encodeURIComponent(assessment.id)}">${full.inspection ? 'Review / rerun inspection' : 'Add observed evidence'}</a><a class="button ghost" href="/redteam.html?assessment=${encodeURIComponent(assessment.id)}">${full.redTeam ? 'Review / rerun attack test' : 'Add controlled attack-test evidence'}</a>` : ''}${sharingHtml()}<div class="result-limit-note"><strong>Trust boundary</strong><p>This result reflects the answers and linked evidence within this assessment scope. Unknown answers are information gaps, not findings. Untested production behaviour remains a limitation.</p></div>
      </aside>
    </div>`;
  wire();
}

function workItemList(items, renderer, noun) {
  const visible = items.slice(0, 3);
  const remaining = items.slice(3);
  return `<div class="plain-finding-list">${visible.map((item, index) => renderer(item, index)).join('')}${remaining.length ? `<details class="finding-more"><summary>View ${remaining.length} additional ${noun}${remaining.length === 1 ? '' : 's'}</summary><div class="finding-work-body">${remaining.map((item, index) => renderer(item, index + 3)).join('')}</div></details>` : ''}</div>`;
}

function unresolvedWorkItem(item, index) {
  return `<details class="finding-work-item" ${index === 0 ? 'open' : ''}><summary><span class="finding-id">${escapeHtml(item.id || 'INFO')}</span><strong>${escapeHtml(item.title)}</strong><span class="evidence-chip">Information required</span></summary><div class="finding-work-body"><div class="plain-finding-sections"><div><small>Why this matters</small><p>${escapeHtml(item.whyItMatters || 'This information is needed to complete the assessment.')}</p></div><div><small>What to confirm</small><p>${escapeHtml(item.whatToConfirm || 'Confirm the current state with the agent owner.')}</p></div><div><small>Useful evidence</small><p>${escapeHtml(item.proof || 'A reviewed configuration or repeatable test.')}</p></div></div></div></details>`;
}

function findingWorkItem(finding, index) {
  const owner = ownerForFinding(finding);
  const proof = finding.verification || proofForFinding(finding);
  return `<details class="finding-work-item" ${index === 0 ? 'open' : ''}><summary><span class="finding-id">${escapeHtml(finding.id || 'RISK')}</span><strong>${escapeHtml(finding.title)}</strong><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></summary><div class="finding-work-body"><div class="plain-finding-sections"><div><small>What we found</small><p>${escapeHtml(finding.observed)}</p></div><div><small>What could happen</small><p>${escapeHtml(finding.impact || 'The weakness may increase the chance or impact of an unsafe action.')}</p></div><div><small>What to do</small><p>${escapeHtml(finding.recommendation || 'Implement and test an appropriate protection.')}</p></div><div><small>Who should own it</small><p>${escapeHtml(owner)}</p></div><div><small>How to prove it is fixed</small><p>${escapeHtml(proof)}</p></div></div><details class="finding-technical"><summary>Technical provenance</summary><p><strong>Evidence state:</strong> ${escapeHtml(finding.evidence || 'Not stated')}</p>${(finding.frameworks || []).length ? `<div class="framework-tags">${finding.frameworks.map((tag) => `<span class="framework-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}</details></div></details>`;
}

function plainDecision(value, unresolvedCount = 0, findingCount = 0) {
  const decisions = {
    'DO NOT DEPLOY': { state: 'stop', label: 'Stop and fix first', title: 'Do not use this agent in production yet.', explanation: 'A declared critical weakness or credible critical attack path needs remediation and retesting before production use.' },
    'DEPLOY ONLY AFTER MATERIAL REMEDIATION': { state: 'hold', label: 'Important fixes required', title: 'Fix the material risks before wider use.', explanation: 'The declared controls contain weaknesses that should be closed before the agent handles more users, data or authority.' },
    'HOLD FOR INFORMATION AND REMEDIATION': { state: 'hold', label: 'Information and fixes required', title: 'Resolve the missing information and declared weaknesses before deployment.', explanation: `${unresolvedCount || 'Material'} unanswered security question${unresolvedCount === 1 ? '' : 's'} remain and ${findingCount || 'material'} declared control weakness${findingCount === 1 ? '' : 'es'} require remediation. Unknowns are not vulnerabilities, but the known weaknesses still matter.` },
    'HOLD FOR INFORMATION': { state: 'hold', label: 'Information required', title: 'Complete the missing security information before a deployment decision.', explanation: `${unresolvedCount || 'Material'} unanswered security question${unresolvedCount === 1 ? '' : 's'} remain. This does not mean those items are vulnerabilities; it means the current assessment cannot yet determine the deployment posture.` },
    'HOLD FOR EVIDENCE': { state: 'hold', label: 'Proof required', title: 'Pause until the important protections are proven.', explanation: 'The declared controls look relevant, but the result does not yet contain enough tested or reviewed evidence to rely on them.' },
    'PROCEED WITH CONDITIONS': { state: 'caution', label: 'Proceed carefully', title: 'You can continue with the listed conditions.', explanation: 'Address the declared weaknesses, keep the agent within the stated limits and reassess after material changes.' },
    'PROCEED WITH MONITORING': { state: 'proceed', label: 'Proceed with monitoring', title: 'The declared risk is low enough to continue cautiously.', explanation: 'Keep monitoring, preserve the current boundaries and verify important controls before expanding access or authority.' },
  };
  return decisions[value] || { state: 'hold', label: 'Review required', title: 'Review this agent before wider use.', explanation: 'The assessment needs an accountable person to review the risks and evidence.' };
}

function ownerForFinding(finding) {
  const tags = new Set(finding.tags || []);
  if (tags.has('privacy') || tags.has('data')) return 'Privacy or data-protection owner with the agent owner';
  if (tags.has('permissions') || tags.has('secrets') || tags.has('egress')) return 'Platform, cloud or IT administrator';
  if (tags.has('approval') || tags.has('high-impact')) return 'Business owner and engineering owner together';
  if (tags.has('monitoring') || tags.has('incident-response')) return 'Security operations or incident-response owner';
  if (tags.has('governance')) return 'Accountable product or business owner';
  return 'The named owner of this AI agent';
}

function proofForFinding(finding) {
  const tags = new Set(finding.tags || []);
  if (tags.has('permissions')) return 'A current permission export or repeatable test showing only required resources and actions are allowed.';
  if (tags.has('secrets')) return 'Vault configuration and a test showing credentials are scoped, rotated and absent from prompts, logs and source.';
  if (tags.has('approval')) return 'A test showing the exact target, action and value cannot execute without a valid, one-time human approval.';
  if (tags.has('prompt-injection') || tags.has('tools')) return 'A controlled test showing untrusted content cannot override policy or reach a denied tool action.';
  if (tags.has('incident-response')) return 'A timed exercise showing the agent, queues, tools, credentials and relevant persistent state can be contained.';
  if (tags.has('monitoring')) return 'An alert and audit record from a repeatable unsafe-action test, without exposing sensitive raw content.';
  if (tags.has('data') || tags.has('privacy')) return 'A reviewed data-flow record plus access and retention settings for the exact agent scope.';
  return 'A current configuration record or repeatable test linked to this exact agent and finding.';
}

function remediationHtml(full) {
  const items = full.recommendations || [];
  if (!items.length) return '';
  return `<section class="workspace-section" id="actionPlan"><div class="workspace-section-heading"><div><span class="eyebrow">Action plan</span><h2>Recommended fixes</h2><p>Assign work, attach implementation evidence and retest before closure.</p></div><a class="button primary small" href="${assessmentRemediationHref({ assessmentId: assessment.id, token, isOwner })}">Track fixes</a></div><div class="simple-remediation-list">${items.map((item, index) => `<article><span>${index + 1}</span><div><strong>${escapeHtml(item.text)}</strong><p>Priority: ${escapeHtml(item.priority)}. Recommendation is not proof of implementation.</p></div></article>`).join('')}</div></section>`;
}

function technicalEvidenceHtml(full, paid) {
  if (!full.inspection && !full.redTeam) return '<p class="microcopy">No observed inspection or controlled attack-test evidence is linked to this assessment yet.</p>';
  return `<div class="section-gap">${full.inspection ? `<section class="inspection-panel"><div class="section-heading compact-heading"><div><span class="eyebrow">Observed evidence</span><h3>Technical inspection</h3></div><span class="assurance-badge">${escapeHtml(full.inspection.assurance)}</span></div><p>${escapeHtml(full.inspection.summary.conclusion)}</p><div class="trust-note"><strong>Trust boundary:</strong> ${escapeHtml(full.inspection.trust.boundary)}</div>${(paid ? full.inspection.findings : full.inspection.findings.slice(0, 3)).map(inspectorFindingHtml).join('')}</section>` : ''}${full.redTeam ? `<section class="redteam-panel section-gap"><div class="section-heading compact-heading"><div><span class="eyebrow">Test-generated evidence</span><h3>Attack simulation</h3></div><a class="button ghost small" href="/redteam-run.html?id=${encodeURIComponent(full.redTeam.id)}">View full run</a></div><p>${escapeHtml(full.redTeam.campaign?.target?.mode === 'simulation' ? 'This verifies the test runner only. It is not evidence about the assessed target.' : full.redTeam.summary.decision)}</p><div class="trust-note"><strong>Trust boundary:</strong> ${escapeHtml(full.redTeam.trust.boundary)}</div>${(paid ? full.redTeam.failedResults : full.redTeam.failedResults.slice(0, 3)).map(redTeamCaseHtml).join('')}</section>` : ''}</div>`;
}

function pathHtml(path) {
  return `<article class="finding attack-path"><div class="finding-head"><h4>${escapeHtml(path.id)} ${escapeHtml(path.title)}</h4><span class="severity ${escapeHtml(path.severity)}">${escapeHtml(path.severity)}</span></div><p>${escapeHtml(path.narrative)}</p><div class="framework-tags">${(path.frameworks || []).map((tag) => `<span class="framework-tag">${escapeHtml(tag)}</span>`).join('')}</div></article>`;
}

function inspectorFindingHtml(finding) {
  return `<article class="finding observed-finding"><div class="finding-head"><h4>${escapeHtml(finding.ruleId)} ${escapeHtml(finding.title)}</h4><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></div><p>${escapeHtml(finding.summary)}</p><p><strong>Confidence:</strong> ${escapeHtml(finding.confidence)} · <strong>Category:</strong> ${escapeHtml(finding.category)}</p>${finding.review ? `<div class="trust-note"><strong>${escapeHtml(finding.review.status)}</strong> · Owner ${escapeHtml(finding.review.owner)} · Expires ${escapeHtml(finding.review.expires || 'not set')}<br>${escapeHtml(finding.review.reason)}</div>` : ''}${(finding.evidence || []).slice(0, 4).map((item) => `<p class="evidence-chip">${escapeHtml(item.basename || item.pathHash)}${item.line ? ` · line ${item.line}` : ''} · ${escapeHtml(item.fact)}</p>`).join('')}<p><strong>Fix:</strong> ${escapeHtml(finding.remediation)}</p></article>`;
}

function redTeamCaseHtml(item) {
  return `<article class="finding observed-finding"><div class="finding-head"><h4>${escapeHtml(item.caseId)} ${escapeHtml(item.title)}</h4><span class="outcome ${escapeHtml(item.outcome)}">${escapeHtml(item.outcome)}</span></div><p><strong>${escapeHtml(item.category)}</strong> · ${escapeHtml(item.severity)} severity · confidence ${escapeHtml(item.confidence)}</p>${(item.evidence || []).map((evidence) => `<p class="evidence-chip">${escapeHtml(evidence.fact)}</p>`).join('')}<p><strong>Fix:</strong> ${escapeHtml(item.remediation)}</p></article>`;
}

function sharingHtml() {
  if (!isOwner) return '';
  if (!assessment.publicEnabled) return `<div class="share-box"><label class="muted">Public sharing is off</label><p class="microcopy">This result is private by default.</p><button class="button ghost small" id="toggleSharing">Enable public summary</button></div>`;
  return `<div class="share-box"><label class="muted">Public summary link</label><input id="shareUrl" readonly value="${location.origin}/shared.html?token=${encodeURIComponent(assessment.shareToken)}"><button class="button ghost small" id="copyShare">Copy result link</button><button class="button danger small" id="toggleSharing">Disable public sharing</button></div>`;
}

function wire() {
  document.querySelector('#toggleSharing')?.addEventListener('click', toggleSharing);
  document.querySelector('#copyShare')?.addEventListener('click', () => copyText(document.querySelector('#shareUrl').value, 'Result link copied'));
  document.querySelector('#buyPro')?.addEventListener('click', (event) => checkout('pro_report', event.currentTarget));
}

async function toggleSharing(event) {
  setBusy(event.currentTarget, true, assessment.publicEnabled ? 'Disabling…' : 'Enabling…');
  try {
    const result = await api(`/api/assessments/${encodeURIComponent(id)}/sharing`, { method: 'POST', body: JSON.stringify({ enabled: !assessment.publicEnabled }) });
    assessment.publicEnabled = result.publicEnabled;
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function checkout(productKey, button) {
  if (!user) {
    location.href = `/auth.html?claimAssessmentId=${encodeURIComponent(id)}&claimToken=${encodeURIComponent(token)}&next=${encodeURIComponent(`/result.html?id=${id}&token=${token}`)}`;
    return;
  }
  setBusy(button, true, 'Opening secure checkout…');
  try {
    await api(`/api/assessments/${encodeURIComponent(id)}/claim`, { method: 'POST', body: JSON.stringify({ token }) }).catch(() => null);
    const { url } = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ productKey, assessmentId: id }) });
    location.href = url;
  } catch (error) {
    alert(error.message);
    setBusy(button, false);
  }
}

async function copyText(value, message) {
  try { await navigator.clipboard.writeText(value); alert(message); }
  catch { prompt('Copy this value:', value); }
}

function fail(message) {
  root.className = 'panel';
  root.innerHTML = `<div class="error-box show">${escapeHtml(message)}</div><a class="button primary" href="/assessment.html">Start a new security assessment</a>`;
}

init();
