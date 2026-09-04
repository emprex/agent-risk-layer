import { api, escapeHtml, qs } from './shared.js';
import { buildEvidencePlan } from './evidence-plan.js';
import { classifyEvidencePlan } from './evidence-plan-outcomes.js';

const assessmentId = qs('id');
let rendered = false;
let currentReview = null;

async function fullRuns(assessmentId) {
  const { runs = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/redteam`);
  const hydrated = await Promise.all(runs.map(async (summary) => {
    if (!summary?.id) return null;
    try { return (await api(`/api/redteam/runs/${encodeURIComponent(summary.id)}`)).run || null; }
    catch { return null; }
  }));
  return hydrated.filter(Boolean);
}

function resultData(assessment = {}) { return assessment.result || assessment || {}; }
function listCount(value) { return Array.isArray(value) ? value.length : 0; }
function materialInformationCount(assessment = {}) {
  const result = resultData(assessment);
  return Math.max(listCount(result.unresolvedItems), listCount(result.blockingInformationGaps));
}
function rawEvidenceQuestionCount(assessment = {}) { return listCount(resultData(assessment).blockingEvidenceGaps); }
function recordedEvidenceGapCount(plan = {}) { return (plan.resolved || []).filter((item) => item.resolution?.state === 'evidence-gap').length; }
function manualEvidenceGapCount(plan = {}) { return listCount(plan.manual); }
function deploymentDecision(assessment = {}) { return resultData(assessment).deploymentDecision || null; }
function decisionLabel(value = '') {
  if (value === 'proceed') return 'Proceed';
  if (value === 'hold') return 'Hold';
  if (value === 'do_not_deploy') return 'Do not deploy';
  return 'No decision recorded';
}

function boundedCheckHref(assessmentId, item) {
  const query = new URLSearchParams({ assessment: assessmentId, case: item.check.caseId, plan: item.check.id });
  return `/redteam.html?${query.toString()}`;
}

function reviewState({ assessment, plan, outcome }) {
  const informationGaps = materialInformationCount(assessment);
  const recordedEvidenceGaps = recordedEvidenceGapCount(plan);
  const manualEvidenceGaps = manualEvidenceGapCount(plan);
  const rawEvidenceQuestions = rawEvidenceQuestionCount(assessment);
  const confirmedFailures = outcome.confirmedFailures.length;
  const blockers = {
    informationGaps,
    recordedEvidenceGaps,
    manualEvidenceGaps,
    rawEvidenceQuestions,
    confirmedFailures,
  };
  const proceedBlocked = Object.values(blockers).some((value) => Number(value) > 0);
  return { blockers, proceedBlocked, existingDecision: deploymentDecision(assessment) };
}

function nextAction({ assessment, inspections, plan, outcome, review }) {
  if (!inspections.length) {
    return {
      stage: 'PROVE',
      title: 'Run source evidence',
      body: 'Freeze the source evidence for this assessment before choosing runtime checks.',
      href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}`,
      action: 'Run source evidence',
    };
  }
  const failure = outcome.confirmedFailures[0];
  if (failure) {
    const query = new URLSearchParams({ assessment: assessment.id, source: 'redteam', case: failure.check.caseId, plan: failure.check.id, baseline: failure.evidence.latestRun.id });
    if (failure.evidence.latestRun.authorisationId) query.set('roe', failure.evidence.latestRun.authorisationId);
    return {
      stage: 'FIX',
      title: 'Fix the confirmed bounded-test failure',
      body: `${failure.check.caseId} reproduced a failure. Assign an owner, preserve implementation evidence, then retest the exact case.`,
      href: `/control-plane.html?${query.toString()}#remediation`,
      action: 'Fix confirmed failure',
    };
  }
  const uncertain = outcome.inconclusive[0];
  if (uncertain) {
    return {
      stage: 'PROVE',
      title: 'Rerun the inconclusive bounded check',
      body: 'The last run did not establish pass or failure. Correct the test condition without turning it into a finding.',
      href: boundedCheckHref(assessment.id, uncertain),
      action: 'Rerun bounded check',
    };
  }
  const neverRun = outcome.checks.find((item) => item.evidence.state === 'open');
  if (neverRun) {
    return {
      stage: 'PROVE',
      title: 'Run the remaining bounded evidence check',
      body: 'A material evidence question has no authorised target result yet. Run only the selected bounded check rather than a generic attack suite.',
      href: boundedCheckHref(assessment.id, neverRun),
      action: 'Run bounded check',
    };
  }
  const supportingOnly = outcome.checks.find((item) => item.evidence.state === 'supporting-pass');
  if (supportingOnly) {
    return {
      stage: 'PROVE',
      title: 'Strengthen the supporting pass evidence',
      body: 'The starting probe passed, but there is no reproduced failed baseline and exact retest lineage. Keep this as supporting evidence until the remaining evidence question is reviewed.',
      href: `/inspector.html?assessment=${encodeURIComponent(assessment.id)}`,
      action: 'Review evidence plan',
    };
  }

  if (review.existingDecision) {
    return {
      stage: 'DEPLOY',
      title: `Deployment decision recorded: ${decisionLabel(review.existingDecision.decision)}`,
      body: 'Review the recorded human decision, its rationale and the evidence limitations that were present when it was made.',
      href: '#deploymentReview',
      action: 'Review deployment decision',
    };
  }

  if (review.proceedBlocked) {
    return {
      stage: 'DEPLOY',
      title: 'Record the deployment decision with evidence gaps',
      body: 'No confirmed bounded-test failure is open, but material information or evidence gaps remain. An accountable human can record Hold or Do not deploy. Proceed stays unavailable while those gaps remain.',
      href: '#deploymentReview',
      action: 'Record deployment decision',
    };
  }

  const exactSupported = outcome.checks.filter((item) => item.evidence.state === 'exact-retest-supported');
  return {
    stage: 'DEPLOY',
    title: 'Open deployment review',
    body: exactSupported.length
      ? `${exactSupported.length} mapped bounded check${exactSupported.length === 1 ? '' : 's'} ${exactSupported.length === 1 ? 'has' : 'have'} exact before/after support for the selected probe. That evidence remains bounded; an accountable human must review the full chain before recording a decision.`
      : 'No confirmed finding is open. An accountable human must still review the complete evidence chain before recording Proceed, Hold or Do not deploy.',
    href: '#deploymentReview',
    action: 'Open deployment review',
  };
}

function journeyHtml(action) {
  return `<section class="workspace-section result-evidence-journey" data-result-evidence-journey>
    <span class="eyebrow">Customer journey</span>
    <h2>Assess → Evidence → Findings → Fix → Retest → Decision</h2>
    <div class="workspace-next-action"><small>Current step · ${escapeHtml(action.stage)}</small><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.body)}</p><a class="button primary small" href="${escapeHtml(action.href)}">${escapeHtml(action.action)}</a></div>
    <p class="microcopy">AgentRiskLayer provides evidence and keeps uncertainty visible. A declaration is not proof, an evidence gap is not a finding, and a runtime result is not a deployment decision.</p>
  </section>`;
}

function confirmedFindingsHtml(outcome, review) {
  const failures = outcome.confirmedFailures || [];
  const cards = failures.map((item) => `<article class="finding-work-item"><div class="finding-work-body"><div class="question-meta"><span>Confirmed bounded-test failure</span><span>${escapeHtml(item.check.caseId || item.check.id)}</span></div><h3>${escapeHtml(item.check.title)}</h3><p>${escapeHtml(item.evidence.explanation)}</p><div class="plain-finding-sections"><div><small>What happened</small><p>The authorised target-specific bounded case reproduced a failure.</p></div><div><small>What to do</small><p>Assign the fix, preserve implementation evidence and rerun this exact bounded case before closure.</p></div></div></div></article>`).join('');
  const limitations = review.blockers.recordedEvidenceGaps + review.blockers.manualEvidenceGaps;
  const noFinding = `<div class="success-box"><strong>No confirmed findings are currently eligible for remediation.</strong><p>Source observations, questionnaire concerns, unknown information and evidence gaps are kept separate from findings. They can still justify a Hold decision.</p></div>`;
  return `<section class="workspace-section" id="confirmedFindings" data-confirmed-findings><div class="workspace-section-heading"><div><span class="eyebrow">Findings</span><h2>${failures.length ? `${failures.length} confirmed finding${failures.length === 1 ? '' : 's'}` : 'No confirmed findings'}</h2><p>A finding appears here only when reviewed evidence or an authorised bounded test supports a failure. Unknown or inconclusive information is not promoted into a vulnerability.</p></div></div>${failures.length ? `<div class="plain-finding-list">${cards}</div>` : noFinding}${limitations ? `<p class="microcopy">${limitations} recorded or reviewer-defined evidence limitation${limitations === 1 ? '' : 's'} remain visible for the deployment reviewer.</p>` : ''}</section>`;
}

function blockerSummary(review) {
  const parts = [];
  const b = review.blockers;
  if (b.informationGaps) parts.push(`${b.informationGaps} information gap${b.informationGaps === 1 ? '' : 's'}`);
  if (b.recordedEvidenceGaps) parts.push(`${b.recordedEvidenceGaps} recorded evidence gap${b.recordedEvidenceGaps === 1 ? '' : 's'}`);
  if (b.manualEvidenceGaps) parts.push(`${b.manualEvidenceGaps} reviewer-defined evidence question${b.manualEvidenceGaps === 1 ? '' : 's'}`);
  if (b.confirmedFailures) parts.push(`${b.confirmedFailures} confirmed bounded-test failure${b.confirmedFailures === 1 ? '' : 's'}`);
  if (!parts.length && b.rawEvidenceQuestions) parts.push(`${b.rawEvidenceQuestions} unresolved evidence question${b.rawEvidenceQuestions === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'No material blocker is currently recorded.';
}

function deploymentReviewHtml(review) {
  const existing = review.existingDecision;
  const existingHtml = existing ? `<div class="trust-note"><strong>${escapeHtml(decisionLabel(existing.decision))}</strong><br>${escapeHtml(existing.rationale || '')}<br><small>Recorded ${escapeHtml(existing.recordedAt || '')}. This is a human decision, not an AgentRiskLayer automatic approval.</small></div>` : '';
  return `<section class="workspace-section" id="deploymentReview" data-deployment-review>
    <div class="workspace-section-heading"><div><span class="eyebrow">Deployment decision</span><h2>${existing ? `Current decision: ${escapeHtml(decisionLabel(existing.decision))}` : 'Human review required'}</h2><p>Review the evidence chain and limitations, then record the accountable decision for this assessed revision.</p></div></div>
    ${existingHtml}
    <div class="result-limit-note"><strong>Evidence state</strong><p>${escapeHtml(blockerSummary(review))}</p></div>
    <div class="field section-gap"><label for="deploymentDecisionRationale">Decision rationale</label><textarea id="deploymentDecisionRationale" rows="4" maxlength="3000" placeholder="State why the evidence supports this decision and which limitations remain.">${escapeHtml(existing?.rationale || '')}</textarea><small>Required. The rationale is retained with the decision.</small></div>
    <div class="button-row">
      <button class="button primary" type="button" data-deployment-decision="proceed" ${review.proceedBlocked ? 'disabled aria-disabled="true"' : ''}>Proceed</button>
      <button class="button secondary" type="button" data-deployment-decision="hold">Hold</button>
      <button class="button secondary" type="button" data-deployment-decision="do_not_deploy">Do not deploy</button>
    </div>
    <p class="microcopy">${review.proceedBlocked ? 'Proceed is unavailable while material information gaps, evidence gaps or confirmed failures remain. Hold records that more evidence or remediation is required.' : 'Proceed is available for accountable human review; it is never inferred from a scan or test result.'}</p>
  </section>`;
}

function syncSummary(root, { inspections, outcome, review, action }) {
  if (!inspections.length) return;
  const summary = root.querySelector('.result-decision-card');
  if (!summary) return;
  const confirmed = outcome.confirmedFailures.length;
  const evidenceLimitations = review.blockers.recordedEvidenceGaps + review.blockers.manualEvidenceGaps;
  const informationGaps = review.blockers.informationGaps;
  const heading = summary.querySelector('h2');
  const explanation = heading?.nextElementSibling;
  if (confirmed) {
    if (heading) heading.textContent = `${confirmed} confirmed finding${confirmed === 1 ? '' : 's'} require remediation.`;
    if (explanation) explanation.textContent = 'Only evidence-backed failures are promoted into Findings. Fix and exact retest are required before the affected issue can close.';
  } else if (review.proceedBlocked) {
    if (heading) heading.textContent = 'No confirmed findings; evidence gaps remain.';
    if (explanation) explanation.textContent = `The frozen revision has been inspected and the bounded evidence plan has been reviewed. ${informationGaps} information gap${informationGaps === 1 ? '' : 's'} and ${evidenceLimitations} recorded or reviewer-defined evidence limitation${evidenceLimitations === 1 ? '' : 's'} remain. These are not vulnerabilities, but they limit deployment assurance.`;
  } else {
    if (heading) heading.textContent = 'Evidence review complete; human deployment decision required.';
    if (explanation) explanation.textContent = 'No confirmed finding is open from the evidence reviewed for this assessment. An accountable human must still record the deployment decision.';
  }
  const cells = [...summary.querySelectorAll('.result-reason-grid > div')];
  if (cells[0]) { cells[0].querySelector('strong').textContent = String(confirmed); cells[0].querySelector('span').textContent = `confirmed finding${confirmed === 1 ? '' : 's'}`; }
  if (cells[1]) { cells[1].querySelector('strong').textContent = String(informationGaps); cells[1].querySelector('span').textContent = `information gap${informationGaps === 1 ? '' : 's'}`; }
  if (cells[2]) { cells[2].querySelector('strong').textContent = confirmed ? 'Confirmed' : 'None'; cells[2].querySelector('span').textContent = 'highest confirmed finding'; }
  if (cells[3]) { cells[3].querySelector('strong').textContent = String(evidenceLimitations); cells[3].querySelector('span').textContent = `evidence limitation${evidenceLimitations === 1 ? '' : 's'}`; }
  const next = summary.querySelector('.result-next-action');
  const title = next?.querySelector('strong');
  const detail = next?.querySelector('p');
  const button = next?.querySelector('a.button');
  if (title) title.textContent = action.title;
  if (detail) detail.textContent = action.body;
  if (button) { button.href = action.href; button.textContent = action.action; }
}

function normaliseTechnicalEvidence(root, assessment) {
  const panel = root.querySelector('#evidenceDetails .inspection-panel');
  if (!panel || panel.dataset.resultSurfaceNormalised === 'true') return;
  panel.dataset.resultSurfaceNormalised = 'true';
  const heading = panel.querySelector('h3');
  if (heading) heading.textContent = 'Source observations';
  const eyebrow = panel.querySelector('.eyebrow');
  if (eyebrow) eyebrow.textContent = 'Observed source evidence';
  const cards = [...panel.querySelectorAll('article.observed-finding')];
  const usable = cards.filter((card) => (card.querySelector('h4')?.textContent || '').trim());
  cards.filter((card) => !usable.includes(card)).forEach((card) => card.remove());
  const total = usable.length;
  usable.slice(5).forEach((card) => card.remove());
  const note = document.createElement('div');
  note.className = 'trust-note';
  note.innerHTML = `<strong>Source observations are not confirmed findings.</strong> They are triage signals from read-only source inspection and do not prove runtime behaviour.${total > 5 ? ` Showing 5 of ${total} observations here.` : ''} <a class="text-link" href="/inspector.html?assessment=${encodeURIComponent(assessment.id)}">Review full evidence</a>`;
  panel.insertBefore(note, panel.querySelector('article.observed-finding') || null);
}

function ensureResultSections(root, context) {
  syncSummary(root, context);
  normaliseTechnicalEvidence(root, context.assessment);
  if (!root.querySelector('[data-confirmed-findings]')) {
    const declared = root.querySelector('#priorityRisks');
    if (declared) declared.insertAdjacentHTML('beforebegin', confirmedFindingsHtml(context.outcome, context.review));
  }
  if (!root.querySelector('[data-deployment-review]')) {
    const bodySection = root.querySelector('.result-body-grid > section');
    if (bodySection) bodySection.insertAdjacentHTML('beforeend', deploymentReviewHtml(context.review));
  }
  const localNav = root.querySelector('.workspace-local-nav');
  if (localNav && !localNav.querySelector('a[href="#confirmedFindings"]')) {
    const summaryLink = localNav.querySelector('a[href="#summary"]');
    summaryLink?.insertAdjacentHTML('afterend', '<a href="#confirmedFindings">Findings</a>');
  }
  if (localNav && !localNav.querySelector('a[href="#deploymentReview"]')) localNav.insertAdjacentHTML('beforeend', '<a href="#deploymentReview">Decision</a>');
}

function insertJourney(html) {
  if (rendered || document.querySelector('[data-result-evidence-journey]')) return true;
  const target = document.querySelector('.result-target-card') || document.querySelector('.result-side-panel');
  if (!target) return false;
  if (target.classList.contains('result-target-card')) target.insertAdjacentHTML('afterend', html);
  else target.insertAdjacentHTML('afterbegin', html);
  rendered = true;
  return true;
}

function applyWhenResultReady(context, journey) {
  const root = document.querySelector('#resultRoot');
  const apply = () => {
    if (!root?.querySelector('.result-decision-card')) return false;
    ensureResultSections(root, context);
    insertJourney(journey);
    return true;
  };
  if (apply()) return;
  const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
}

async function load() {
  if (!assessmentId) return;
  try {
    const [assessmentPayload, inspectionPayload, runs] = await Promise.all([
      api(`/api/assessments/${encodeURIComponent(assessmentId)}`),
      api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`),
      fullRuns(assessmentId),
    ]);
    const assessment = assessmentPayload.assessment || {};
    const inspections = [...(inspectionPayload.inspections || [])].sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const plan = buildEvidencePlan({ assessment, inspections });
    const outcome = classifyEvidencePlan(plan, runs);
    const review = reviewState({ assessment, plan, outcome });
    const action = nextAction({ assessment, inspections, plan, outcome, review });
    const context = { assessment, inspections, plan, outcome, review, action };
    currentReview = context;
    applyWhenResultReady(context, journeyHtml(action));
  } catch {
    // Shared/public assessment views may not have owner-only Evidence APIs. Do not weaken their existing result view.
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-deployment-decision]');
  if (!button || !assessmentId || !currentReview) return;
  const decision = button.dataset.deploymentDecision;
  if (decision === 'proceed' && currentReview.review.proceedBlocked) return;
  const rationale = document.querySelector('#deploymentDecisionRationale')?.value?.trim() || '';
  if (rationale.length < 20) { window.alert('Add an evidence-based deployment rationale of at least 20 characters.'); return; }
  const buttons = [...document.querySelectorAll('[data-deployment-decision]')];
  buttons.forEach((item) => { item.disabled = true; });
  try {
    await api(`/api/assessments/${encodeURIComponent(assessmentId)}/deployment-decision`, { method: 'POST', body: JSON.stringify({ decision, rationale }) });
    location.reload();
  } catch (error) {
    window.alert(error.message);
    buttons.forEach((item) => { item.disabled = item.dataset.deploymentDecision === 'proceed' && currentReview.review.proceedBlocked; });
  }
});

void load();
