import { api, escapeHtml } from './shared.js';
import { buildEvidencePlan } from './evidence-plan.js';

let activeAssessmentId = '';
let serial = 0;

function selectedAssessmentId() { return document.querySelector('#assessmentSelect')?.value || new URLSearchParams(location.search).get('assessment') || sessionStorage.getItem('arl_selected_assessment') || ''; }
function gapLabel(gap = {}) { return gap.title || gap.name || gap.id || 'Material evidence question'; }
function checkAction(check, assessmentId) { const params = new URLSearchParams({ assessment: assessmentId }); const caseId=check.caseId; if (caseId) params.set('case', caseId); params.set('plan', check.id); return `/redteam.html?${params.toString()}`; }

function checkHtml(check, index, assessmentId) {
  const automatedAction = check.caseId
    ? `<a class="button primary small" href="${checkAction(check, assessmentId)}">Open bounded check</a>`
    : `<button class="button primary small" type="button" data-review-bounded="${escapeHtml(check.id)}">Review bounded check</button>`;
  const reviewerPanel = check.caseId ? '' : `<div class="success-box section-gap" id="review-${escapeHtml(check.id)}" data-review-panel hidden><strong>Reviewer-defined bounded check</strong><p>No automated Red Team case is mapped to this invariant yet. Review the target-specific evidence against the bounded cases above. If a safe bounded runtime test cannot be executed, record an evidence gap. Do not substitute source declarations or a generic attack suite for target runtime proof.</p></div>`;
  return `<article class="finding-work-item" ${index === 0 ? 'data-primary-evidence-check="true"' : ''}><div class="finding-work-body">
    <div class="question-meta"><span>Bounded runtime check</span><span>${escapeHtml(check.environment)}</span></div><h3>${escapeHtml(check.title)}</h3><p>${escapeHtml(check.why)}</p>
    <div class="plain-finding-sections"><div><small>Security invariant</small><p>${escapeHtml(check.invariant)}</p></div><div><small>Bounded cases</small><p>${check.cases.map(escapeHtml).join(' · ')}</p></div><div><small>Evidence question</small><p>${escapeHtml(gapLabel(check.gap))}</p></div></div>
    ${check.caseId ? `<p class="microcopy">Existing controlled-test case: <code>${escapeHtml(check.caseId)}</code>. The case is a starting probe for this question; it does not by itself prove every invariant case above.</p>` : '<p class="microcopy">No existing automated case fully covers this invariant yet. Use the reviewer path below; do not run the full catalogue as a substitute.</p>'}
    <div class="button-row compact">${automatedAction}<button class="button secondary small" type="button" data-evidence-gap="${escapeHtml(check.id)}">Record evidence gap</button><button class="button secondary small" type="button" data-evidence-not-applicable="${escapeHtml(check.id)}">Mark not applicable</button></div>
    ${reviewerPanel}
    <p class="microcopy">Record an evidence gap when the boundary is material but bounded runtime verification cannot be completed. This is not a PASS, finding or verified control. Use Not applicable only when reviewed evidence shows the boundary is not materially present.</p>
  </div></article>`;
}

function resolvedHtml(item) { const r = item.resolution || {}; const gap = r.state === 'evidence-gap'; return `<article class="finding-work-item"><div class="finding-work-body"><div class="question-meta"><span>${gap ? 'Runtime verification disposition' : 'Resolved by applicability'}</span><span>${gap ? 'Evidence still needed' : 'Not applicable'}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(r.rationale || (gap ? 'Bounded runtime verification was not completed.' : 'No material runtime boundary identified.'))}</p><p class="microcopy">This disposition is not a PASS, verified control, confirmed finding or deployment approval.</p></div></article>`; }

function planHtml(plan, assessmentId) {
  const resolved = plan.resolved?.length ? `<details class="workspace-technical section-gap"><summary><span>${plan.resolved.length} recorded disposition${plan.resolved.length === 1 ? '' : 's'}</span><small>Not counted as PASS</small></summary><div class="workspace-technical-body"><div class="plain-finding-list">${plan.resolved.map(resolvedHtml).join('')}</div></div></details>` : '';
  if (plan.state === 'source-required') return `<section class="workspace-section section-gap" data-evidence-plan><span class="eyebrow">Evidence plan</span><h2>${escapeHtml(plan.title)}</h2><p>${escapeHtml(plan.explanation)}</p><div class="workspace-next-action"><small>Next action</small><strong>Run the read-only source inspection.</strong></div></section>`;
  if (plan.state === 'bounded-check-required') return `<section class="workspace-section section-gap" data-evidence-plan><div class="workspace-section-heading"><div><span class="eyebrow">Evidence plan</span><h2>${escapeHtml(plan.checks.length === 1 ? '1 bounded runtime check selected' : `${plan.checks.length} bounded runtime checks selected`)}</h2><p>${escapeHtml(plan.explanation)}</p></div></div><div class="success-box"><strong>Source evidence complete.</strong><p>Static source observations are not automatically confirmed vulnerabilities. Run only what is needed: the bounded checks required for material questions source review cannot prove.</p></div><div class="plain-finding-list">${plan.checks.map((c,i)=>checkHtml(c,i,assessmentId)).join('')}</div>${resolved}${plan.manual.length ? `<details class="workspace-technical section-gap"><summary><span>${plan.manual.length} other evidence question${plan.manual.length===1?'':'s'}</span></summary><div class="workspace-technical-body"><ul class="check-list">${plan.manual.map(g=>`<li>${escapeHtml(gapLabel(g))}</li>`).join('')}</ul></div></details>` : ''}</section>`;
  const manualNotice=plan.manual.length?'<div class="notice"><strong>No safe automatic bounded test selected.</strong><p>Keep these questions as evidence gaps until a reviewer defines a target-specific safe test. Do not invent a finding or substitute a generic attack suite.</p></div>':'';
  return `<section class="workspace-section section-gap" data-evidence-plan><span class="eyebrow">Evidence plan</span><h2>${escapeHtml(plan.title)}</h2><p>${escapeHtml(plan.explanation)}</p>${manualNotice}${resolved}${plan.manual.length ? `<ul class="check-list">${plan.manual.map(g=>`<li>${escapeHtml(gapLabel(g))}</li>`).join('')}</ul>` : ''}</section>`;
}

function insertPlan(html, attempt=0) { const anchor=document.querySelector('[data-inspector-target-panel]')||document.querySelector('.workspace-agent-command'); if(!anchor){if(attempt<20)setTimeout(()=>insertPlan(html,attempt+1),100);return;} document.querySelector('[data-evidence-plan]')?.remove(); anchor.insertAdjacentHTML('afterend',html); }
async function loadPlan(assessmentId) { if(!assessmentId)return; const requestSerial=++serial; activeAssessmentId=assessmentId; try { const [a,i]=await Promise.all([api(`/api/assessments/${encodeURIComponent(assessmentId)}`),api(`/api/assessments/${encodeURIComponent(assessmentId)}/inspections`)]); if(requestSerial!==serial||activeAssessmentId!==assessmentId)return; const inspections=[...(i.inspections||[])].sort((x,y)=>Date.parse(y.createdAt||0)-Date.parse(x.createdAt||0)); insertPlan(planHtml(buildEvidencePlan({assessment:a.assessment||{},inspections}),assessmentId)); } catch(error){ if(requestSerial!==serial||activeAssessmentId!==assessmentId)return; insertPlan(`<section class="workspace-section section-gap" data-evidence-plan><h2>Evidence plan unavailable</h2><p>${escapeHtml(error.message)}</p></section>`); } }
function sync(){const id=selectedAssessmentId();if(!id)return;if(id===activeAssessmentId&&document.querySelector('[data-evidence-plan]'))return;loadPlan(id);}

const observer=new MutationObserver(()=>{const id=selectedAssessmentId();if(id&&(id!==activeAssessmentId||!document.querySelector('[data-evidence-plan]')))loadPlan(id);}); observer.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('change',e=>{if(e.target?.id==='assessmentSelect'){activeAssessmentId='';serial+=1;queueMicrotask(sync);}});
document.addEventListener('click',async e=>{
  if(e.target?.id==='refreshScans'){const id=selectedAssessmentId();if(id){activeAssessmentId='';setTimeout(()=>loadPlan(id),300);}return;}
  const reviewButton=e.target?.closest?.('[data-review-bounded]');
  if(reviewButton){const panel=document.querySelector(`#review-${CSS.escape(reviewButton.dataset.reviewBounded)}`);if(panel){panel.hidden=!panel.hidden;reviewButton.textContent=panel.hidden?'Review bounded check':'Hide reviewer guidance';if(!panel.hidden)panel.scrollIntoView({block:'nearest',behavior:'smooth'});}return;}
  const gapButton=e.target?.closest?.('[data-evidence-gap]');
  const naButton=e.target?.closest?.('[data-evidence-not-applicable]');
  const button=gapButton||naButton; if(!button)return;
  const assessmentId=selectedAssessmentId(); const planId=gapButton?.dataset.evidenceGap || naButton?.dataset.evidenceNotApplicable; if(!assessmentId||!planId)return;
  const isGap=Boolean(gapButton);
  const rationale=window.prompt(isGap ? 'Why could bounded runtime verification not be completed? Record the evidence-based reason.' : 'Why is this bounded runtime check not materially applicable? Record the evidence-based reason.');
  if(rationale===null)return; if(rationale.trim().length<20){window.alert('Add a specific evidence-based rationale (at least 20 characters).');return;}
  button.disabled=true; const original=button.textContent; button.textContent='Saving…';
  try { await api(`/api/assessments/${encodeURIComponent(assessmentId)}/evidence-plan/resolutions`,{method:'POST',body:JSON.stringify({planId,state:isGap?'evidence-gap':'not-applicable',rationale:rationale.trim()})}); activeAssessmentId=''; await loadPlan(assessmentId); }
  catch(error){ window.alert(error.message); button.disabled=false; button.textContent=original; }
});
document.addEventListener('arl:source-evidence-recorded',e=>{const id=e.detail?.assessmentId||selectedAssessmentId();if(id){activeAssessmentId='';serial+=1;setTimeout(()=>loadPlan(id),100);}});
sync();
