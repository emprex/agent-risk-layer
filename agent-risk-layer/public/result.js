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
    const [assessmentResponse, authResponse] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`),
      api('/api/auth/me'),
    ]);
    assessment = assessmentResponse.assessment;
    isOwner = assessmentResponse.isOwner;
    user = authResponse.user;
    render();
  } catch (error) {
    fail(error.message);
  }
}

function render() {
  const full = assessment.result;
  const paid = assessment.paidTier !== 'free';
  const scoreColor = assessment.score >= 75 ? 'var(--red)' : assessment.score >= 50 ? 'var(--orange)' : assessment.score >= 25 ? 'var(--yellow)' : 'var(--green)';
  const findings = paid ? full.findings : assessment.topFindings;
  root.className = 'result-grid';
  root.innerHTML = `
    <aside class="panel result-score">
      <span class="eyebrow">Assessment complete</span>
      <div class="score-ring" style="--score:${assessment.score};--score-color:${scoreColor}"><strong>${assessment.score}<small>/100</small></strong></div>
      <div class="risk-pill ${riskClass(assessment.riskBand)}">${escapeHtml(assessment.riskBand)} risk</div>
      <h2>${escapeHtml(assessment.name)}</h2><p class="muted">${escapeHtml(assessment.agentType)}</p>
      ${paid ? `<a class="button primary full" href="/api/reports/${encodeURIComponent(assessment.id)}/pdf?token=${encodeURIComponent(token)}">Download ${assessment.paidTier === 'pro' ? 'professional' : 'essential'} PDF</a>` : `<button class="button primary full" id="buyPro">Unlock professional report · £24.99</button><button class="button ghost full" id="buyBasic">Essential report · £9.99</button>`}
      ${sharingHtml()}
    </aside>
    <section>
      <div class="panel"><span class="eyebrow">Finding</span><h1 class="result-headline">${escapeHtml(full.headline)}</h1><p class="muted">${escapeHtml(full.methodology)}</p><p class="microcopy">Scoring model: ${escapeHtml(assessment.scoringVersion || 'arl-risk-v1.0')}</p></div>
      <div class="panel"><h2>${paid ? 'All material findings' : 'Your three highest-risk findings'}</h2><div class="finding-list ${paid ? '' : 'locked'}">${findings.length ? findings.map(findingHtml).join('') : '<div class="success-box">No material weaknesses were identified by the questionnaire.</div>'}</div>${paid ? '' : `<div class="unlock-box"><h3>There is more behind the score.</h3><p class="muted">Unlock every finding, control recommendation and the 30-day remediation plan.</p><button class="button primary" id="unlockInline">View report options</button></div>`}</div>
      <div class="panel"><h2>Baseline control coverage</h2><div class="control-grid">${assessment.controls.map((c) => `<div class="control ${c.status}">${escapeHtml(c.name)}</div>`).join('')}</div></div>
      ${paid ? `<div class="panel"><h2>Prioritised recommendations</h2><div class="recommendation-list">${full.recommendations.map((item, index) => `<div class="finding"><div class="finding-head"><h4>${index + 1}. ${escapeHtml(item.text)}</h4><span class="severity ${item.priority === 'Immediate' ? 'critical' : item.priority === 'High' ? 'high' : 'medium'}">${escapeHtml(item.priority)}</span></div></div>`).join('')}</div></div><div class="panel"><h2>30-day action plan</h2>${buildActionPlan(full.recommendations)}</div>` : ''}
    </section>`;

  document.querySelector('#toggleSharing')?.addEventListener('click', toggleSharing);
  document.querySelector('#copyShare')?.addEventListener('click', () => copyText(document.querySelector('#shareUrl').value, 'Result link copied'));
  document.querySelector('#copyBadge')?.addEventListener('click', () => copyText(`${location.origin}/badge/${assessment.shareToken}.svg`, 'Badge URL copied'));
  document.querySelector('#buyBasic')?.addEventListener('click', (event) => checkout('basic_report', event.currentTarget));
  document.querySelector('#buyPro')?.addEventListener('click', (event) => checkout('pro_report', event.currentTarget));
  document.querySelector('#unlockInline')?.addEventListener('click', () => document.querySelector('#buyPro').scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function sharingHtml() {
  if (!isOwner) return '';
  if (!assessment.publicEnabled) {
    return `<div class="share-box"><label class="muted">Public sharing is off</label><p class="microcopy">Your result and badge are private until you explicitly enable sharing.</p><button class="button ghost small" id="toggleSharing">Enable public summary</button></div>`;
  }
  return `<div class="share-box"><label class="muted">Public summary link</label><input id="shareUrl" readonly value="${location.origin}/shared.html?token=${encodeURIComponent(assessment.shareToken)}"><button class="button ghost small" id="copyShare">Copy result link</button><button class="button ghost small" id="copyBadge">Copy badge image URL</button><button class="button danger small" id="toggleSharing">Disable public sharing</button></div>`;
}

async function toggleSharing(event) {
  setBusy(event.currentTarget, true, assessment.publicEnabled ? 'Disabling…' : 'Enabling…');
  try {
    const result = await api(`/api/assessments/${encodeURIComponent(id)}/sharing`, { method: 'POST', body: JSON.stringify({ enabled: !assessment.publicEnabled }) });
    assessment.publicEnabled = result.publicEnabled;
    render();
  } catch (error) {
    alert(error.message);
    setBusy(event.currentTarget, false);
  }
}

function findingHtml(finding) {
  return `<article class="finding"><div class="finding-head"><h4>${escapeHtml(finding.id || '')} ${escapeHtml(finding.title)}</h4><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></div><p>${escapeHtml(finding.observed)}</p></article>`;
}

function buildActionPlan(recommendations) {
  if (!recommendations.length) return '<p class="muted">Maintain the current controls and retest after material changes.</p>';
  return `<div class="recommendation-list">${recommendations.slice(0, 8).map((item, index) => `<div class="finding"><div class="finding-head"><h4>${index < 3 ? 'First 24 hours' : index < 6 ? 'First 7 days' : 'Within 30 days'}</h4><span class="severity ${index < 3 ? 'critical' : index < 6 ? 'high' : 'medium'}">${index + 1}</span></div><p>${escapeHtml(item.text)}</p></div>`).join('')}</div>`;
}

async function checkout(productKey, button) {
  if (!user) {
    const next = encodeURIComponent(`/result.html?id=${id}&token=${token}`);
    location.href = `/auth.html?claimAssessmentId=${encodeURIComponent(id)}&claimToken=${encodeURIComponent(token)}&next=${next}`;
    return;
  }
  setBusy(button, true, 'Opening checkout…');
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
  root.innerHTML = `<div class="error-box show">${escapeHtml(message)}</div><a class="button primary" href="/assessment.html">Start a new assessment</a>`;
}

init();
