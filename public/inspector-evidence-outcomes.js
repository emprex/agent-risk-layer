import { api, escapeHtml } from './shared.js';
import { buildEvidencePlan } from './evidence-plan.js';
import { classifyEvidencePlan } from './evidence-plan-outcomes.js';

let activeAssessmentId = '';
let serial = 0;

function selectedAssessmentId() {
  return document.querySelector('#assessmentSelect')?.value
    || new URLSearchParams(location.search).get('assessment')
    || sessionStorage.getItem('arl_selected_assessment')
    || '';
}

function remediationHref(assessmentId, item) {
  const params = new URLSearchParams({ assessment: assessmentId, source: 'redteam', case: item.check.caseId, plan: item.check.id });
  const run = item.evidence.latestRun;
  if (run?.id) params.set('baseline', run.id);
  if (run?.authorisationId) params.set('roe', run.authorisationId);
  return `/control-plane.html?${params.toString()}#remediation`;
}

function rerunHref(assessmentId, item) {
  const params = new URLSearchParams({ assessment: assessmentId, case: item.check.caseId, plan: item.check.id, retest: '1' });
  const baseline = item.evidence.baselineRun || item.evidence.latestRun;
  if (baseline?.id) params.set('baseline', baseline.id);
  if (baseline?.authorisationId) params.set('roe', baseline.authorisationId);
  return `/redteam.html?${params.toString()}`;
}

function stateCopy(item) {
  const state = item.evidence.state;
  if (state === 'confirmed-failure') return { state: 'hold', next: 'Fix this confirmed failure, preserve implementation evidence, then rerun the same bounded case.' };
  if (state === 'inconclusive') return { state: 'unresolved', next: 'Correct the test condition and rerun the same bounded case. Do not create a finding from an inconclusive result.' };
  if (state === 'exact-retest-supported') return { state: 'supported', next: 'Retest lineage supports this starting probe. Send the bounded evidence and remaining limitations to accountable deployment review.' };
  if (state === 'supporting-pass') return { state: 'unresolved', next: 'Keep this as supporting evidence. A passing probe without a failed baseline is not verified remediation.' };
  return { state: 'unresolved', next: item.check.caseId ? 'Run the selected bounded case under written Rules of Engagement.' : 'Define a safe bounded test before collecting runtime evidence.' };
}

function outcomeHtml(outcome, assessmentId) {
  if (!outcome.checks.length) {
    return `<section class="workspace-section section-gap" data-evidence-outcomes>
      <span class="eyebrow">After source evidence</span>
      <h2>No automatic bounded runtime check is mapped from the remaining questions</h2>
      <p>Source inspection is complete. Any unresolved evidence question stays open until appropriate evidence or a reviewer-defined bounded test is available.</p>
    </section>`;
  }

  const cards = outcome.checks.map((item) => {
    const copy = stateCopy(item);
    const run = item.evidence.latestRun;
    const meta = run ? `<p class="microcopy">Latest evidence: <code>${escapeHtml(run.id || 'run')}</code>${run.createdAt ? ` · ${escapeHtml(new Date(run.createdAt).toLocaleString('en-GB'))}` : ''}${run.authorisationId ? ` · ROE <code>${escapeHtml(run.authorisationId)}</code>` : ''}</p>` : '';
    let action = '';
    if (item.evidence.state === 'confirmed-failure') {
      action = `<a class="button primary small" href="${remediationHref(assessmentId, item)}">Fix confirmed failure</a>`;
    } else if (item.evidence.state === 'exact-retest-supported') {
      action = `<a class="button primary small" href="/result.html?id=${encodeURIComponent(assessmentId)}">Review deployment handoff</a>`;
    } else if (item.check.caseId && ['open','inconclusive','supporting-pass'].includes(item.evidence.state)) {
      action = `<a class="button ${item.evidence.state === 'inconclusive' ? 'primary' : 'ghost'} small" href="${rerunHref(assessmentId, item)}">${item.evidence.state === 'inconclusive' ? 'Rerun bounded check' : 'Open exact check'}</a>`;
    }
    return `<article class="workspace-status-card" data-state="${copy.state}" data-evidence-outcome="${escapeHtml(item.check.id)}">
      <small>${escapeHtml(item.check.title)}</small>
      <strong>${escapeHtml(item.evidence.label)}</strong>
      <p>${escapeHtml(item.evidence.explanation)}</p>
      ${meta}
      <p class="microcopy"><strong>Next:</strong> ${escapeHtml(copy.next)}</p>
      ${action}
    </article>`;
  }).join('');

  const primary = outcome.confirmedFailures.length
    ? 'Confirmed test failure requires remediation before retest.'
    : outcome.inconclusive.length
      ? 'Evidence is inconclusive. Keep the question open.'
      : 'No confirmed bounded-test failure is currently open.';

  return `<section class="workspace-section section-gap" data-evidence-outcomes>
    <div class="workspace-section-heading"><div><span class="eyebrow">Bounded evidence outcome</span><h2>${escapeHtml(primary)}</h2><p>AgentRiskLayer binds completed authorised runs back to the Evidence Plan without turning a declaration or inconclusive result into a finding.</p></div></div>
    <div class="workspace-status-grid">${cards}</div>
    <div class="notice"><strong>Evidence boundary</strong><br>${escapeHtml(outcome.limitation)}</div>
    <a class="button ghost small" href="/result.html?id=${encodeURIComponent(assessmentId)}">Return to assessment result</a>
  </section>`;
}

function insert(html) {
  document.querySelector('[data-evidence-outcomes]')?.remove();
  if (!html) return;
  const plan = document.querySelector('[data-evidence-plan]');
  const target = plan || document.querySelector('[data-inspector-target-panel]') || document.querySelector('.workspace-agent-command');
  if (target) target.insertAdjacentHTML('afterend', html);
}

async function hydrateRuns(summaries, requestSerial, assessmentId) {
  const full = await Promise.all((summaries || []).map(async (summary) => {
    if (!summary?.id) return null;
    try {
      const payload = await api(`/api/redteam/runs/${encodeURIComponent(summary.id)}`);
      return payload.run || null;
    } catch {
      return null;
    }
  }));
  if (requestSerial !== serial || activeAssessmentId !== assessmentId) return null;
  return full.filter(Boolean);
}

async function load(assessmentId) {
  const requestSerial = ++serial;
  activeAssessmentId = assessmentId;
  try {
    const [assessmentPayload, inspectionPayload, redteamPayload] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}`),
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`),
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/redteam`),
    ]);
    if (requestSerial !== serial || activeAssessmentId !== assessmentId) return;
    const inspections = [...(inspectionPayload.inspections || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    if (!inspections.length) {
      insert('');
      return;
    }
    const plan = buildEvidencePlan({ assessment: assessmentPayload.assessment || {}, inspections });
    const fullRuns = await hydrateRuns(redteamPayload.runs || [], requestSerial, assessmentId);
    if (!fullRuns) return;
    const outcome = classifyEvidencePlan(plan, fullRuns);
    insert(outcomeHtml(outcome, assessmentId));
  } catch (error) {
    if (requestSerial !== serial || activeAssessmentId !== assessmentId) return;
    insert(`<section class="workspace-section section-gap" data-evidence-outcomes><span class="eyebrow">Bounded evidence outcome</span><h2>Outcome unavailable</h2><p>${escapeHtml(error.message)}</p></section>`);
  }
}

function sync(force = false) {
  const assessmentId = selectedAssessmentId();
  if (!assessmentId || (!force && assessmentId === activeAssessmentId)) return;
  load(assessmentId);
}

const observer = new MutationObserver(() => {
  if (!document.querySelector('[data-evidence-plan]')) return;
  const assessmentId = selectedAssessmentId();
  if (assessmentId && assessmentId !== activeAssessmentId) load(assessmentId);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('change', (event) => {
  if (event.target?.id !== 'assessmentSelect') return;
  activeAssessmentId = '';
  serial += 1;
  queueMicrotask(() => sync(true));
});

document.addEventListener('click', (event) => {
  if (event.target?.id !== 'refreshScans') return;
  setTimeout(() => sync(true), 350);
});

document.addEventListener('arl:source-evidence-recorded', () => {
  setTimeout(() => sync(true), 100);
});

sync(true);
