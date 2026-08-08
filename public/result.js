import { api, escapeHtml, qs, riskClass, setBusy } from './shared.js';

const root = document.querySelector('#resultRoot');
const id = qs('id');
const token = qs('token');
let assessment;
let user;
let isOwner = false;

async function init() {
  if (!id || !token) return fail('The assessment link is incomplete.');
  try {
    const [assessmentPayload, userPayload] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`),
      api('/api/auth/me'),
    ]);
    assessment = assessmentPayload.assessment;
    isOwner = assessmentPayload.isOwner;
    user = userPayload.user;
    render();
  } catch (error) {
    fail(error.message);
  }
}

function metric(value, suffix = '') {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

function render() {
  const full = assessment.result;
  const paid = assessment.paidTier !== 'free';
  const findings = paid ? (full.findings || []) : (assessment.topFindings || full.topFindings || []);
  const unresolved = full.unresolvedItems || full.blockingInformationGaps || [];
  const decision = plainDecision(full.decision, unresolved.length);
  const scoreAvailable = full.scoreAvailable !== false && assessment.riskBand !== 'Undetermined';
  const primaryTarget = unresolved.length ? '#informationNeeded' : '#priorityRisks';
  const primaryLabel = unresolved.length ? 'Complete missing information' : 'See what to fix first';
  root.className = 'plain-result-layout';
  root.innerHTML = `
    <section class="plain-result-main">
      <div class="panel decision-first-card">
        <span class="eyebrow">Your next action</span>
        <div class="decision-state ${escapeHtml(decision.state)}">
          <small>${escapeHtml(decision.label)}</small>
          <h1>${escapeHtml(decision.title)}</h1>
          <p>${escapeHtml(decision.explanation)}</p>
        </div>
        <div class="decision-actions">
          <a class="button primary" href="${primaryTarget}">${primaryLabel}</a>
          ${isOwner ? '<a class="button ghost" href="/dashboard.html">Save and return to my work</a>' : '<a class="button ghost" href="/auth.html">Create an account to save this result</a>'}
        </div>
      </div>

      ${unresolved.length ? `<section class="panel" id="informationNeeded">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Information needed</span><h2>${unresolved.length} security question${unresolved.length === 1 ? '' : 's'} still need an answer</h2><p>These are unresolved assessment inputs, not discovered vulnerabilities. Confirm them with the system owner before relying on a deployment decision.</p></div></div>
        <div class="plain-finding-list">${unresolved.map(unresolvedHtml).join('')}</div>
      </section>` : ''}

      <section class="panel" id="priorityRisks">
        <div class="section-heading compact-heading"><div><span class="eyebrow">Confirmed from your answers</span><h2>${findings.length ? (paid ? 'Declared control weaknesses' : 'The three declared weaknesses to address first') : 'No declared control weakness established yet'}</h2><p>${findings.length ? 'These are based on specific answers you supplied. They remain unverified until linked to reviewed evidence or repeatable tests.' : 'Unknown answers are not treated as vulnerabilities. Complete missing information and add evidence before drawing a security conclusion.'}</p></div></div>
        <div class="plain-finding-list">${findings.length ? findings.map(plainFindingHtml).join('') : '<div class="success-box"><strong>No control weakness was established from the answered questions.</strong><p>This is not a security approval. Missing information and unverified controls can still block deployment.</p></div>'}</div>
        ${paid ? '' : `<div class="unlock-box customer-unlock"><h3>Need a reviewed launch decision?</h3><p>The £99 assessment adds the complete finding register, technical evidence review, controlled attack testing, remediation ownership and a retest decision.</p><button class="button primary" id="unlockInline">Review the £99 assessment</button></div>`}
      </section>

      ${paid ? remediationHtml(full) : ''}

      <details class="panel technical-result-details">
        <summary><span><strong>Technical score and evidence details</strong><small>For security teams, developers and auditors</small></span><span>Open details</span></summary>
        <div class="technical-result-body">
          <div class="metric-grid">
            <div class="metric-card"><span>Overall declared risk</span><strong>${scoreAvailable ? `${assessment.score}/100` : 'Not determined'}</strong></div>
            <div class="metric-card"><span>Exposure</span><strong>${metric(full.inherentRisk, full.inherentRisk === null ? '' : '/100')}</strong></div>
            <div class="metric-card"><span>Control gap</span><strong>${metric(full.controlGap, full.controlGap === null ? '' : '/100')}</strong></div>
            <div class="metric-card"><span>Assessment completeness</span><strong>${metric(full.assessmentCompleteness ?? 100, '%')}</strong></div>
            <div class="metric-card"><span>Evidence confidence</span><strong>${metric(full.evidenceConfidence ?? 0, '%')}</strong></div>
          </div>
          <p class="microcopy">${escapeHtml(full.methodology)}</p>
          <h3>Protection status</h3>
          <div class="control-grid">${assessment.controls.map((control) => `<div class="control ${escapeHtml(control.status)}">${escapeHtml(control.name)}<small class="evidence-chip">${escapeHtml(control.status === 'unresolved' ? 'Information required' : control.evidence || 'Evidence not stated')}</small></div>`).join('')}</div>
          ${paid && full.attackPaths?.length ? `<h3 class="section-gap">Credible attack paths</h3>${full.attackPaths.map(pathHtml).join('')}` : ''}
        </div>
      </details>

      ${technicalEvidenceHtml(full, paid)}
    </section>

    <aside class="panel result-side-summary">
      <span class="eyebrow">Security check</span>
      <h2>${escapeHtml(assessment.name)}</h2>
      <p class="muted">${escapeHtml(assessment.agentType)}</p>
      ${full.systemDescription ? `<p>${escapeHtml(full.systemDescription)}</p>` : ''}
      <div class="result-side-risk">${scoreAvailable ? `<span class="risk-pill ${riskClass(assessment.riskBand)}">${escapeHtml(assessment.riskBand)} declared risk</span><strong>${assessment.score}<small>/100</small></strong>` : '<span class="risk-pill">Assessment incomplete</span><strong>—</strong>'}</div>
      <p class="side-score-explainer">${scoreAvailable ? 'The score prioritises declared risk. It is not a probability of breach and does not prove the agent is secure.' : 'Risk is not scored until enough exposure and control information is known. Missing information is kept separate from vulnerabilities.'}</p>
      ${paid ? `<a class="button primary full" href="/api/reports/${encodeURIComponent(assessment.id)}/pdf?token=${encodeURIComponent(token)}">Download full PDF report</a>` : `<button class="button primary full" id="buyPro">Get reviewed assessment · £99</button>`}
      ${isOwner ? `<a class="button ghost full" href="/inspector.html?assessment=${encodeURIComponent(assessment.id)}">${full.inspection ? 'Run another code and configuration check' : 'Add code and configuration evidence'}</a><a class="button ghost full" href="/redteam.html?assessment=${encodeURIComponent(assessment.id)}">${full.redTeam ? 'Run another attack simulation' : 'Add controlled attack-test evidence'}</a>` : ''}
      ${sharingHtml()}
      <div class="result-limit-note"><strong>What this result means</strong><p>It reflects the answers and linked evidence within this assessment’s scope. Unknown answers are information gaps, not findings. Untested production behaviour remains a limitation.</p></div>
    </aside>`;
  wire();
}

function plainDecision(value, unresolvedCount = 0) {
  const decisions = {
    'DO NOT DEPLOY': { state: 'stop', label: 'Stop and fix first', title: 'Do not use this agent in production yet.', explanation: 'A declared critical weakness or credible critical attack path needs remediation and retesting before production use.' },
    'DEPLOY ONLY AFTER MATERIAL REMEDIATION': { state: 'hold', label: 'Important fixes required', title: 'Fix the material risks before wider use.', explanation: 'The declared controls contain weaknesses that should be closed before the agent handles more users, data or authority.' },
    'HOLD FOR INFORMATION': { state: 'hold', label: 'Information required', title: 'Complete the missing security information before a deployment decision.', explanation: `${unresolvedCount || 'Material'} unanswered security question${unresolvedCount === 1 ? '' : 's'} remain. This does not mean those items are vulnerabilities; it means the current assessment cannot yet determine the deployment posture.` },
    'HOLD FOR EVIDENCE': { state: 'hold', label: 'Proof required', title: 'Pause until the important protections are proven.', explanation: 'The declared controls look relevant, but the result does not yet contain enough tested or reviewed evidence to rely on them.' },
    'PROCEED WITH CONDITIONS': { state: 'caution', label: 'Proceed carefully', title: 'You can continue with the listed conditions.', explanation: 'Address the declared weaknesses, keep the agent within the stated limits and reassess after material changes.' },
    'PROCEED WITH MONITORING': { state: 'proceed', label: 'Proceed with monitoring', title: 'The declared risk is low enough to continue cautiously.', explanation: 'Keep monitoring, preserve the current boundaries and verify important controls before expanding access or authority.' },
  };
  return decisions[value] || { state: 'hold', label: 'Review required', title: 'Review this agent before wider use.', explanation: 'The assessment needs an accountable person to review the risks and evidence.' };
}

function unresolvedHtml(item) {
  return `<article class="plain-finding-card">
    <div class="plain-finding-heading"><div><span>${escapeHtml(item.id || 'Information')}</span><h3>${escapeHtml(item.title)}</h3></div><span class="evidence-chip">Information required</span></div>
    <div class="plain-finding-sections">
      <div><small>Why this matters</small><p>${escapeHtml(item.whyItMatters || 'This information is needed to complete the assessment.')}</p></div>
      <div><small>What to confirm</small><p>${escapeHtml(item.whatToConfirm || 'Confirm the current state with the agent owner.')}</p></div>
      <div><small>Useful evidence</small><p>${escapeHtml(item.proof || 'A reviewed configuration or repeatable test.')}</p></div>
    </div>
  </article>`;
}

function plainFindingHtml(finding) {
  const owner = ownerForFinding(finding);
  const proof = finding.verification || proofForFinding(finding);
  return `<article class="plain-finding-card">
    <div class="plain-finding-heading"><div><span>${escapeHtml(finding.id || 'Risk')}</span><h3>${escapeHtml(finding.title)}</h3></div><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></div>
    <div class="plain-finding-sections">
      <div><small>What we found</small><p>${escapeHtml(finding.observed)}</p></div>
      <div><small>What could happen</small><p>${escapeHtml(finding.impact || 'The weakness may increase the chance or impact of an unsafe action.')}</p></div>
      <div><small>What to do</small><p>${escapeHtml(finding.recommendation || 'Implement and test an appropriate protection.')}</p></div>
      <div><small>Who should own it</small><p>${escapeHtml(owner)}</p></div>
      <div><small>How to prove it is fixed</small><p>${escapeHtml(proof)}</p></div>
    </div>
    <details class="finding-technical"><summary>Technical details</summary><p><strong>Evidence state:</strong> ${escapeHtml(finding.evidence || 'Not stated')}</p>${(finding.frameworks || []).length ? `<div class="framework-tags">${finding.frameworks.map((tag) => `<span class="framework-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}</details>
  </article>`;
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
  return `<section class="panel"><div class="section-heading compact-heading"><div><span class="eyebrow">Action plan</span><h2>Recommended fixes</h2><p>Work from top to bottom, record an owner and attach proof before checking again.</p></div><a class="button ghost small" href="/control-plane.html#remediation">Track fixes</a></div><div class="simple-remediation-list">${items.map((item, index) => `<article><span>${index + 1}</span><div><strong>${escapeHtml(item.text)}</strong><p>Priority: ${escapeHtml(item.priority)}. Mark it complete only after the change is implemented and verified.</p></div></article>`).join('')}</div></section>`;
}

function technicalEvidenceHtml(full, paid) {
  if (!full.inspection && !full.redTeam) return '';
  return `<details class="panel technical-result-details"><summary><span><strong>Observed and attack-test evidence</strong><small>Technical evidence linked to this assessment</small></span><span>Open evidence</span></summary><div class="technical-result-body">
    ${full.inspection ? `<section class="inspection-panel"><div class="section-heading compact-heading"><div><span class="eyebrow">Code and configuration evidence</span><h3>Technical inspection</h3></div><span class="assurance-badge">${escapeHtml(full.inspection.assurance)}</span></div><p>${escapeHtml(full.inspection.summary.conclusion)}</p><div class="trust-note"><strong>Trust boundary:</strong> ${escapeHtml(full.inspection.trust.boundary)}</div>${(paid ? full.inspection.findings : full.inspection.findings.slice(0, 3)).map(inspectorFindingHtml).join('')}</section>` : ''}
    ${full.redTeam ? `<section class="redteam-panel section-gap"><div class="section-heading compact-heading"><div><span class="eyebrow">Controlled attack testing</span><h3>Attack simulation</h3></div><a class="button ghost small" href="/redteam-run.html?id=${encodeURIComponent(full.redTeam.id)}">View full run</a></div><p>${escapeHtml(full.redTeam.campaign?.target?.mode === 'simulation' ? 'This verifies the test runner only. It is not evidence about the assessed target.' : full.redTeam.summary.decision)}</p><div class="trust-note"><strong>Trust boundary:</strong> ${escapeHtml(full.redTeam.trust.boundary)}</div>${(paid ? full.redTeam.failedResults : full.redTeam.failedResults.slice(0, 3)).map(redTeamCaseHtml).join('')}</section>` : ''}
  </div></details>`;
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
  document.querySelector('#unlockInline')?.addEventListener('click', () => document.querySelector('#buyPro')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
  root.innerHTML = `<div class="error-box show">${escapeHtml(message)}</div><a class="button primary" href="/assessment.html">Start a new security check</a>`;
}

init();
