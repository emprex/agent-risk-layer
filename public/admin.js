import { api, escapeHtml, money, setBusy } from './shared.js';
const root = document.querySelector('#adminRoot');

async function init() {
  try {
    const [{ totals, funnel, recentFailures, riskBands, readiness }, operations] = await Promise.all([
      api('/api/admin/analytics'), api('/api/admin/operations'),
    ]);
    root.className = '';
    root.innerHTML = `
      <div class="section-heading"><div><span class="eyebrow">Operational control</span><h2>Service health</h2></div><button id="reconcile" class="button primary">Run reconciliation</button></div>
      <div id="adminMessage" class="success-box" hidden></div><div id="adminError" class="error-box"></div>
      <div class="dashboard-stats">
        <div class="stat"><span>Users</span><strong>${totals.users}</strong><small>${totals.verifiedUsers} verified</small></div>
        <div class="stat"><span>MFA users</span><strong>${totals.mfaUsers}</strong></div>
        <div class="stat"><span>Assessments</span><strong>${totals.assessments}</strong></div>
        <div class="stat"><span>Paid purchases</span><strong>${totals.purchases}</strong><small>${totals.fulfilledPurchases} fulfilled</small></div>
        <div class="stat"><span>Open alerts</span><strong>${totals.openAlerts}</strong></div>
        <div class="stat"><span>Revenue</span><strong class="money-stat">${money(totals.revenuePence)}</strong></div>
      </div>
      <div class="dashboard-grid">
        <section class="panel"><h2>Fulfilment exceptions</h2>${operationRows(operations.fulfilment.incompletePurchases, purchaseLabel)}</section>
        <aside class="panel"><h2>Open operational alerts</h2>${alertRows(operations.fulfilment.openAlerts)}</aside>
      </div>
      <div class="dashboard-grid section-gap">
        <section class="panel"><h2>Queued delivery jobs</h2>${operationRows(operations.fulfilment.queuedJobs, jobLabel)}</section>
        <aside class="panel"><h2>Launch readiness</h2><div class="readiness-banner ${readiness.ready ? 'ready' : 'blocked'}">${readiness.ready ? 'READY' : 'BLOCKED'}</div>${readiness.checks.map(check => `<div class="readiness-row"><span>${escapeHtml(check.label)}${check.required?' *':''}</span><strong class="${check.ok?'pass-text':check.required?'fail-text':'muted'}">${check.ok?'PASS':check.required?'FAIL':'OPTIONAL'}</strong></div>`).join('')}</aside>
      </div>
      <div class="dashboard-grid section-gap">
        <section class="panel"><h2>Product funnel</h2>${rows(funnel, item=>item.name.replaceAll('_',' '), item=>item.count)}</section>
        <aside class="panel"><h2>Assessment risk bands</h2>${rows(riskBands,item=>item.band,item=>item.count)}</aside>
      </div>
      <section class="panel section-gap"><h2>Recent email failures</h2>${recentFailures.length ? recentFailures.map(item=>`<div class="assessment-row"><div><strong>${escapeHtml(item.subject)}</strong><div class="assessment-meta"><span>${escapeHtml(item.to_email)}</span><span>${new Date(item.created_at).toLocaleString('en-GB')}</span></div><p class="fail-text small-copy">${escapeHtml(item.error||'Unknown provider error')}</p></div></div>`).join('') : '<p class="muted">No failed email deliveries.</p>'}</section>`;
    document.querySelector('#reconcile').addEventListener('click', reconcile);
    document.querySelectorAll('[data-resolve-alert]').forEach(button=>button.addEventListener('click', resolveAlert));
  } catch (error) {
    if (error.message.includes('Sign in')) location.href=`/auth.html?next=${encodeURIComponent('/admin.html')}`;
    else if (error.code === 'ADMIN_MFA_REQUIRED') root.innerHTML='<div class="error-box show">Enable MFA and sign in with it before accessing owner operations.</div>';
    else root.innerHTML=`<div class="error-box show">${escapeHtml(error.message)}</div>`;
  }
}
function rows(items,label,value){return items.length?items.map(item=>`<div class="assessment-row"><strong>${escapeHtml(label(item))}</strong><span class="score-badge">${escapeHtml(value(item))}</span></div>`).join(''):'<p class="muted">No data yet.</p>';}
function operationRows(items,label){return items.length?items.map(item=>`<div class="assessment-row"><div><strong>${escapeHtml(label(item))}</strong><div class="assessment-meta"><span>${escapeHtml(item.status||item.fulfilment_state||'')}</span><span>${new Date(item.updated_at||item.created_at).toLocaleString('en-GB')}</span></div>${item.last_error||item.fulfilment_error||item.email_error?`<p class="fail-text small-copy">${escapeHtml(item.last_error||item.fulfilment_error||item.email_error)}</p>`:''}</div></div>`).join(''):'<p class="pass-text">No unresolved items.</p>';}
function alertRows(items){return items.length?items.map(item=>`<div class="assessment-row"><div><strong>${escapeHtml(item.category)}</strong><p>${escapeHtml(item.message)}</p><div class="assessment-meta"><span>${escapeHtml(item.severity)}</span><span>${new Date(item.created_at).toLocaleString('en-GB')}</span></div></div><button class="button ghost small" data-resolve-alert="${escapeHtml(item.id)}">Resolve</button></div>`).join(''):'<p class="pass-text">No open alerts.</p>';}
function purchaseLabel(item){return `${item.product_key}: ${item.fulfilment_state} / ${item.email_state}`;}
function jobLabel(item){return `${item.job_type}: attempt ${item.attempts}`;}
async function reconcile(event){setBusy(event.currentTarget,true,'Reconciling…');try{const data=await api('/api/admin/operations/reconcile',{method:'POST',body:'{}'});const box=document.querySelector('#adminMessage');box.textContent=`Reconciliation finished: ${data.fulfilment.fulfilled} purchases recovered, ${data.jobs.completed} jobs completed, ${data.retention.recordsDeleted} expired evidence records purged.`;box.hidden=false;setTimeout(()=>location.reload(),1200);}catch(error){const box=document.querySelector('#adminError');box.textContent=error.message;box.classList.add('show');setBusy(event.currentTarget,false);}}
async function resolveAlert(event){setBusy(event.currentTarget,true,'Resolving…');try{await api(`/api/admin/alerts/${encodeURIComponent(event.currentTarget.dataset.resolveAlert)}/resolve`,{method:'POST',body:'{}'});location.reload();}catch(error){alert(error.message);setBusy(event.currentTarget,false);}}
init();
