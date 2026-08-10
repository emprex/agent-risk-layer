import { api, escapeHtml, money, setBusy } from './shared.js';
const root = document.querySelector('#salesRoot');
let prospects = [];
let messages = [];
let selectedId = null;

async function load() {
  try {
    const [overviewData, prospectsData, messagesData] = await Promise.all([
      api('/api/admin/sales/overview'), api('/api/admin/sales/prospects'), api('/api/admin/sales/messages'),
    ]);
    prospects = prospectsData.prospects;
    messages = messagesData.messages;
    if (!selectedId && prospects[0]) selectedId = prospects[0].id;
    render(overviewData.overview);
  } catch (error) {
    if (error.status === 401) location.href = `/auth.html?next=${encodeURIComponent('/sales-agent.html')}`;
    else if (error.code === 'ADMIN_MFA_REQUIRED') root.innerHTML = '<div class="error-box show">Enable MFA and sign in with it before accessing the Sales Agent.</div>';
    else root.innerHTML = `<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}
function render(overview) {
  const t = overview.totals;
  root.className = '';
  root.innerHTML = `
    <div class="dashboard-stats">
      <div class="stat"><span>Prospects</span><strong>${t.prospects}</strong></div>
      <div class="stat"><span>Pipeline</span><strong>${money(t.pipelineValuePence)}</strong></div>
      <div class="stat"><span>Messages sent</span><strong>${t.sent}</strong><small>${t.approved} approved</small></div>
      <div class="stat"><span>Demos</span><strong>${t.demos}</strong></div>
      <div class="stat"><span>Customers</span><strong>${t.customers}</strong></div>
      <div class="stat"><span>Recorded revenue</span><strong>${money(t.assessmentRevenuePence + t.subscriptionRevenuePence)}</strong></div>
    </div>
    <div class="sales-layout section-gap">
      <aside class="panel">
        <div class="section-heading"><div><span class="eyebrow">Pipeline</span><h2>Prospects</h2></div></div>
        <div class="sales-stage-row">${overview.stages.map(x=>`<span>${escapeHtml(x.stage.replaceAll('_',' '))} <strong>${x.count}</strong></span>`).join('')}</div>
        <div class="sales-prospect-list">${prospects.length ? prospects.map(prospectButton).join('') : '<p class="muted">No prospects yet. Add the first evidence-backed company.</p>'}</div>
      </aside>
      <section class="sales-main">
        <section class="panel"><div class="section-heading"><div><span class="eyebrow">Research</span><h2>Add qualified prospect</h2></div></div>${prospectForm()}</section>
        ${selectedId ? detailPanel() : ''}
      </section>
    </div>`;
  bind();
}
function prospectButton(p) {
  return `<button class="project-button ${p.id===selectedId?'active':''}" data-select="${escapeHtml(p.id)}"><strong>${escapeHtml(p.companyName)}</strong><small>${escapeHtml(p.stage.replaceAll('_',' '))} · score ${p.score}</small><span class="status-dot"></span></button>`;
}
function prospectForm() {
  return `<form id="prospectForm" class="mini-form">
    <div class="form-grid">
      <label>Company name *<input name="companyName" maxlength="200" required></label>
      <label>Company website<input name="website" type="url" placeholder="https://"></label>
      <label>Company size<select name="companySize"><option value="">Unknown</option><option>1-10</option><option>11-50</option><option>51-200</option><option>201+</option></select></label>
      <label>Source<input name="source" placeholder="LinkedIn, launch directory, referral"></label>
      <label>Buyer name<input name="buyerName"></label>
      <label>Buyer role<input name="buyerRole" placeholder="Founder, CTO, Head of AI"></label>
      <label>Buyer email<input name="buyerEmail" type="email"></label>
      <label>Buyer LinkedIn<input name="buyerLinkedin" type="url" placeholder="https://linkedin.com/in/..."></label>
    </div>
    <label>Verified trigger signal<textarea name="triggerSignal" rows="2" placeholder="Public launch, funding, MCP release, hiring signal…"></textarea></label>
    <label>Agent use case<textarea name="agentUseCase" rows="2" placeholder="What the agent does, based on public evidence"></textarea></label>
    <label>Tools, data or systems it can access<textarea name="toolAccess" rows="2" placeholder="Only record verified facts"></textarea></label>
    <label>Evidence links or notes (one per line)<textarea name="evidence" rows="2"></textarea></label>
    <div id="formError" class="error-box"></div><button class="button primary" type="submit">Score and add prospect</button>
  </form>`;
}
function editProspectForm(p) {
  const companySizes = ['', '1-10', '11-50', '51-200', '201+'];
  return `<form id="editProspectForm" class="mini-form section-gap">
    <div class="form-grid">
      <label>Company name *<input name="companyName" maxlength="200" required value="${escapeHtml(p.companyName||'')}"></label>
      <label>Company website<input name="website" type="url" placeholder="https://" value="${escapeHtml(p.website||'')}"></label>
      <label>Company size<select name="companySize">${companySizes.map(x=>`<option value="${escapeHtml(x)}" ${x===(p.companySize||'')?'selected':''}>${escapeHtml(x||'Unknown')}</option>`).join('')}</select></label>
      <label>Source<input name="source" value="${escapeHtml(p.source||'')}"></label>
      <label>Buyer name<input name="buyerName" value="${escapeHtml(p.buyerName||'')}"></label>
      <label>Buyer role<input name="buyerRole" placeholder="Founder, CTO, Head of AI" value="${escapeHtml(p.buyerRole||'')}"></label>
      <label>Buyer email<input name="buyerEmail" type="email" value="${escapeHtml(p.buyerEmail||'')}"></label>
      <label>Buyer LinkedIn<input name="buyerLinkedin" type="url" placeholder="https://linkedin.com/in/..." value="${escapeHtml(p.buyerLinkedin||'')}"></label>
      <label>Estimated value £<input name="estimatedValuePounds" type="number" min="0" step="0.01" value="${escapeHtml(((Number(p.estimatedValuePence)||0)/100).toFixed(2))}"></label>
    </div>
    <label>Verified trigger signal<textarea name="triggerSignal" rows="2" placeholder="Public launch, funding, MCP release, hiring signal…">${escapeHtml(p.triggerSignal||'')}</textarea></label>
    <label>Agent use case<textarea name="agentUseCase" rows="2" placeholder="What the agent does, based on public evidence">${escapeHtml(p.agentUseCase||'')}</textarea></label>
    <label>Tools, data or systems it can access<textarea name="toolAccess" rows="2" placeholder="Only record verified facts">${escapeHtml(p.toolAccess||'')}</textarea></label>
    <label>Evidence links or notes (one per line)<textarea name="evidence" rows="3">${escapeHtml((p.evidence||[]).join('\n'))}</textarea></label>
    <label>Internal notes<textarea name="notes" rows="3">${escapeHtml(p.notes||'')}</textarea></label>
    <div class="button-row compact"><button class="button primary small" type="submit">Save prospect</button></div>
  </form>`;
}
function detailPanel() {
  const p = prospects.find(x=>x.id===selectedId);
  if (!p) return '';
  const prospectMessages = messages.filter(x=>x.prospectId===p.id);
  return `<section class="panel">
    <div class="section-heading"><div><span class="eyebrow">Qualified account</span><h2>${escapeHtml(p.companyName)}</h2></div><strong class="score-badge">${p.score}/100</strong></div>
    <div class="sales-facts"><div><span>Buyer</span><strong>${escapeHtml([p.buyerName,p.buyerRole].filter(Boolean).join(' · ')||'Not identified')}</strong></div><div><span>Trigger</span><strong>${escapeHtml(p.triggerSignal||'Not recorded')}</strong></div><div><span>Use case</span><strong>${escapeHtml(p.agentUseCase||'Not recorded')}</strong></div><div><span>Access</span><strong>${escapeHtml(p.toolAccess||'Not recorded')}</strong></div></div>
    <p class="small-copy muted">${p.scoreReasons.map(escapeHtml).join(' · ')}</p>
    <details class="section-gap"><summary><strong>Edit prospect</strong> · buyer, evidence and qualification facts</summary>${editProspectForm(p)}</details>
    <form id="stageForm" class="inline-form"><select name="stage">${['research','qualified','contacted','replied','demo_booked','assessment_proposed','customer','subscription','lost'].map(x=>`<option value="${x}" ${x===p.stage?'selected':''}>${x.replaceAll('_',' ')}</option>`).join('')}</select><input name="nextAction" value="${escapeHtml(p.nextAction||'')}" placeholder="Next action"><input name="nextActionAt" type="datetime-local" value="${escapeHtml(localDate(p.nextActionAt))}"><button class="button ghost small">Update</button></form>
    <form id="activityForm" class="inline-form"><select name="activityType"><option value="reply">Reply</option><option value="follow_up">Follow-up</option><option value="demo">Demo</option><option value="proposal">Proposal</option><option value="assessment_sold">Assessment sold</option><option value="subscription_sold">Subscription sold</option><option value="note">Note</option></select><input name="outcome" placeholder="Outcome or note"><input name="amountPounds" type="number" min="0" step="0.01" placeholder="Revenue £"><button class="button ghost small">Record result</button></form>
    <div class="section-heading section-gap"><div><span class="eyebrow">Approval queue</span><h2>Personalised outreach</h2></div></div>
    <div class="button-row compact"><button class="button ghost small" data-draft="connection">Connection</button><button class="button ghost small" data-draft="first_message">First message</button><button class="button ghost small" data-draft="assessment_offer">£99 offer</button><button class="button ghost small" data-draft="follow_up">Follow-up</button><button class="button ghost small" data-demo>Demo brief</button></div>
    <div id="messageList">${prospectMessages.length ? prospectMessages.map(messageCard).join('') : '<p class="muted section-gap">No drafts yet. Add verified context before generating one.</p>'}</div>
    <div id="salesError" class="error-box"></div>
  </section>`;
}
function messageCard(m) {
  return `<article class="sales-message"><div class="assessment-meta"><span>${escapeHtml(m.messageType.replaceAll('_',' '))}</span><span class="outcome ${m.status==='approved'||m.status==='sent'?'passed':'inconclusive'}">${escapeHtml(m.status)}</span></div>${m.subject?`<strong>${escapeHtml(m.subject)}</strong>`:''}<textarea data-message-body="${escapeHtml(m.id)}" rows="6">${escapeHtml(m.body)}</textarea><small class="muted">Factual basis: ${escapeHtml(m.factualBasis.join(' · ')||'manual')}</small><div class="button-row compact">${m.status==='draft'?`<button class="button primary small" data-approve="${escapeHtml(m.id)}">Approve</button><button class="button danger small" data-reject="${escapeHtml(m.id)}">Reject</button>`:''}${m.status==='approved'?`<button class="button primary small" data-sent="${escapeHtml(m.id)}">Mark sent</button>`:''}<button class="button ghost small" data-copy="${escapeHtml(m.id)}">Copy</button></div></article>`;
}
function bind() {
  document.querySelectorAll('[data-select]').forEach(x=>x.addEventListener('click',()=>{selectedId=x.dataset.select; renderCurrent();}));
  document.querySelector('#prospectForm')?.addEventListener('submit', addProspect);
  document.querySelector('#editProspectForm')?.addEventListener('submit', editProspect);
  document.querySelector('#stageForm')?.addEventListener('submit', updateStage);
  document.querySelector('#activityForm')?.addEventListener('submit', recordResult);
  document.querySelectorAll('[data-draft]').forEach(x=>x.addEventListener('click', draft));
  document.querySelectorAll('[data-approve],[data-reject],[data-sent]').forEach(x=>x.addEventListener('click', updateMessage));
  document.querySelectorAll('[data-copy]').forEach(x=>x.addEventListener('click', copyMessage));
  document.querySelector('[data-demo]')?.addEventListener('click', showDemo);
}
async function renderCurrent(){await load();}
async function addProspect(event) {
  event.preventDefault(); const button=event.submitter; setBusy(button,true,'Scoring…');
  const data=Object.fromEntries(new FormData(event.currentTarget));
  data.evidence=String(data.evidence||'').split('\n').map(x=>x.trim()).filter(Boolean);
  try { const {prospect}=await api('/api/admin/sales/prospects',{method:'POST',body:JSON.stringify(data)}); selectedId=prospect.id; await load(); }
  catch(error){const box=document.querySelector('#formError');box.textContent=error.message;box.classList.add('show');setBusy(button,false);}
}
async function editProspect(event) {
  event.preventDefault(); const button=event.submitter; setBusy(button,true,'Saving…');
  const data=Object.fromEntries(new FormData(event.currentTarget));
  data.evidence=String(data.evidence||'').split('\n').map(x=>x.trim()).filter(Boolean);
  data.estimatedValuePence=Math.max(0,Math.round((Number(data.estimatedValuePounds)||0)*100));
  delete data.estimatedValuePounds;
  try {await api(`/api/admin/sales/prospects/${encodeURIComponent(selectedId)}`,{method:'PATCH',body:JSON.stringify(data)});await load();}
  catch(error){showSalesError(error);setBusy(button,false);}
}
async function updateStage(event) {
  event.preventDefault(); const data=Object.fromEntries(new FormData(event.currentTarget));
  if(data.nextActionAt) data.nextActionAt=new Date(data.nextActionAt).toISOString();
  try {await api(`/api/admin/sales/prospects/${encodeURIComponent(selectedId)}`,{method:'PATCH',body:JSON.stringify(data)});await load();} catch(error){showSalesError(error);}
}
async function recordResult(event) {
  event.preventDefault(); const data=Object.fromEntries(new FormData(event.currentTarget));
  data.amountPence=data.amountPounds ? Math.round(Number(data.amountPounds)*100) : null;
  delete data.amountPounds;
  try {await api(`/api/admin/sales/prospects/${encodeURIComponent(selectedId)}/activities`,{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();await load();} catch(error){showSalesError(error);}
}
async function draft(event) {
  setBusy(event.currentTarget,true,'Drafting…');
  try {await api(`/api/admin/sales/prospects/${encodeURIComponent(selectedId)}/messages`,{method:'POST',body:JSON.stringify({messageType:event.currentTarget.dataset.draft,channel:'linkedin'})});await load();} catch(error){showSalesError(error);setBusy(event.currentTarget,false);}
}
async function updateMessage(event) {
  const id=event.currentTarget.dataset.approve||event.currentTarget.dataset.reject||event.currentTarget.dataset.sent;
  const status=event.currentTarget.dataset.approve?'approved':event.currentTarget.dataset.reject?'rejected':'sent';
  const body=document.querySelector(`[data-message-body="${CSS.escape(id)}"]`)?.value;
  try {await api(`/api/admin/sales/messages/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status,body})});await load();} catch(error){showSalesError(error);}
}
async function copyMessage(event) {
  const body=document.querySelector(`[data-message-body="${CSS.escape(event.currentTarget.dataset.copy)}"]`)?.value||'';
  await navigator.clipboard.writeText(body); event.currentTarget.textContent='Copied';
}
async function showDemo() {
  try {const {brief}=await api(`/api/admin/sales/prospects/${encodeURIComponent(selectedId)}/demo-brief`);alert([brief.opening,'',...brief.qualificationQuestions,'',...brief.sequence,'',brief.close,'',...brief.claimBoundaries].join('\n'));}catch(error){showSalesError(error);}
}
function showSalesError(error){const box=document.querySelector('#salesError');if(box){box.textContent=error.message;box.classList.add('show');}}
function localDate(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.valueOf())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
load();
