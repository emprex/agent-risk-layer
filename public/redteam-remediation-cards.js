import { api, escapeHtml } from './shared.js';
import { classifyBoundedCheckEvidence } from './evidence-plan-outcomes.js';

const params = new URLSearchParams(location.search);
const assessmentId = params.get('assessment') || '';
let busy = false;

function redTeamCaseId(remediation) {
  const match = String(remediation?.finding_key || '').match(/:redteam-(RT-[A-Z0-9-]+)$/i);
  return match?.[1]?.toUpperCase() || '';
}

async function hydrateRuns() {
  const { runs = [] } = await api(`/api/assessments/${encodeURIComponent(assessmentId)}/redteam`);
  const hydrated = await Promise.all(runs.map(async (summary) => {
    try { return (await api(`/api/redteam/runs/${encodeURIComponent(summary.id)}`)).run || null; }
    catch { return null; }
  }));
  return hydrated.filter(Boolean);
}

function card(remediation, evidence) {
  const caseId = redTeamCaseId(remediation);
  const closed = remediation.status === 'verified_closed' && remediation.verification?.retestSourceType === 'redteam';
  const exact = evidence.state === 'exact-retest-supported';
  const closure = exact && !closed
    ? `<div class="notice success"><strong>Accountable closure review</strong><p>The exact bounded case has a failed baseline and a later passing retest with matching ROE, target, policy and request fingerprint. Accept only if this is the evidence you intend to rely on for this exact finding.</p><button class="button primary" type="button" data-accept-redteam-retest data-remediation-id="${escapeHtml(remediation.id)}" data-case-id="${escapeHtml(caseId)}" data-baseline-run-id="${escapeHtml(evidence.baselineRun.id)}" data-retest-run-id="${escapeHtml(evidence.latestRun.id)}">Accept exact retest evidence and close finding</button><p class="error-box" data-redteam-closure-error hidden></p></div>`
    : closed
      ? `<div class="notice success"><strong>Verified closed</strong><br>An accountable reviewer accepted exact Red Team retest evidence for <code>${escapeHtml(remediation.verification?.retestCaseId || caseId)}</code>. Reassess if the model, tools, permissions, data, prompts or environment change.</div>`
      : `<div class="notice"><strong>Verification still open</strong><br>${escapeHtml(evidence.explanation || 'No exact retest lineage currently supports closure.')}</div>`;
  return `<article class="workspace-section section-gap" data-redteam-remediation-card="${escapeHtml(remediation.id)}">
    <span class="eyebrow">Confirmed Red Team remediation</span>
    <h3>${escapeHtml(caseId)} · ${escapeHtml(closed ? 'Verified closed' : exact ? 'Exact retest ready for review' : 'Fix and retest')}</h3>
    <div class="plain-finding-sections">
      <div><small>Fix</small><p>${escapeHtml(remediation.title || 'Remediate the reproduced failure.')}</p></div>
      <div><small>Owner</small><p>${escapeHtml(remediation.owner_email || 'Unassigned')}</p></div>
      <div><small>Current status</small><p>${escapeHtml(String(remediation.status || 'open').replaceAll('_',' '))}</p></div>
      <div><small>Exact retest</small><p>Use the same case, Rules of Engagement, authorised target, policy version and request fingerprint as the failed baseline.</p></div>
    </div>
    ${closure}
    <p class="microcopy">Closure is bounded to this exact Red Team case. It is not proof of unrelated controls, production equivalence or a deployment decision.</p>
  </article>`;
}

function bindActions(container, projectId) {
  container.querySelectorAll('[data-accept-redteam-retest]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const errorBox = button.parentElement?.querySelector('[data-redteam-closure-error]');
      button.disabled = true;
      button.textContent = 'Recording closure…';
      if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/remediations/${encodeURIComponent(button.dataset.remediationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'verified_closed',
            verification: {
              redTeamClosure: {
                caseId: button.dataset.caseId,
                baselineRunId: button.dataset.baselineRunId,
                retestRunId: button.dataset.retestRunId,
              },
            },
          }),
        });
        location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Accept exact retest evidence and close finding';
        if (errorBox) { errorBox.hidden = false; errorBox.classList.add('show'); errorBox.textContent = error.message; }
      }
    });
  });
}

async function render() {
  if (!assessmentId || busy) return;
  const anchor = document.querySelector('.remediation-plan-list');
  if (!anchor) return;
  busy = true;
  try {
    const projectId = sessionStorage.getItem('arl_selected_project') || '';
    if (!projectId) return;
    const [{ project }, runs] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}`),
      hydrateRuns(),
    ]);
    const remediations = (project?.remediations || []).filter((item) => item.assessment_id === assessmentId && redTeamCaseId(item));
    if (!remediations.length) {
      document.querySelector('[data-redteam-remediation-review]')?.remove();
      return;
    }
    const rows = remediations.map((remediation) => {
      const caseId = redTeamCaseId(remediation);
      return { remediation, evidence: classifyBoundedCheckEvidence({ caseId, title: caseId }, runs) };
    });
    const signature = rows.map(({remediation,evidence}) => `${remediation.id}:${remediation.status}:${evidence.state}:${evidence.latestRun?.id || ''}`).join('|');
    let container = document.querySelector('[data-redteam-remediation-review]');
    if (container?.dataset.signature === signature) return;
    if (!container) {
      container = document.createElement('section');
      container.dataset.redteamRemediationReview = 'true';
      anchor.insertAdjacentElement('afterend', container);
    }
    container.dataset.signature = signature;
    container.innerHTML = `<div class="workspace-section-heading"><div><span class="eyebrow">Red Team fix → retest</span><h2>Accountable bounded retest review</h2><p>Only exact retained before/after evidence can support closure of these reproduced findings.</p></div></div>${rows.map(({remediation,evidence}) => card(remediation,evidence)).join('')}`;
    bindActions(container, projectId);
  } catch {
    // Keep the core remediation page usable if Red Team evidence cannot be loaded.
  } finally {
    busy = false;
  }
}

if (assessmentId) {
  void render();
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; void render(); });
  });
  observer.observe(document.querySelector('#controlPlaneRoot') || document.body, { childList: true, subtree: true });
}
