import { api, escapeHtml, setBusy } from './shared.js';

const root=document.querySelector('#inspectorRoot');
let assessments=[];
let selectedId='';
let activeTokenState=null;
let tokenExpiryTimer=null;

function tokenIsValidForSelected(){
  if(!activeTokenState||activeTokenState.assessmentId!==selectedId)return false;
  const expiresAt=Date.parse(activeTokenState.expiresAt);
  return Number.isFinite(expiresAt)&&expiresAt>Date.now();
}

function syncTokenButton(){
  const button=document.querySelector('#createToken');
  if(!button)return;
  const ready=tokenIsValidForSelected();
  button.textContent=ready?'Token ready':activeTokenState?.assessmentId===selectedId?'Create new token':'Create inspection command';
  button.disabled=ready;
}

function scheduleTokenExpiry(){
  if(tokenExpiryTimer)clearTimeout(tokenExpiryTimer);
  tokenExpiryTimer=null;
  if(!activeTokenState)return;
  const delay=Date.parse(activeTokenState.expiresAt)-Date.now();
  if(!Number.isFinite(delay)||delay<=0){
    syncTokenButton();
    return;
  }
  tokenExpiryTimer=setTimeout(()=>{
    tokenExpiryTimer=null;
    syncTokenButton();
  },Math.min(delay+50,2147483647));
}

async function init(){
  try{
    const data=await api('/api/dashboard');
    assessments=data.assessments;
    const requested=new URLSearchParams(location.search).get('assessment')||sessionStorage.getItem('arl_selected_assessment')||'';
    selectedId=assessments.some(item=>item.id===requested)?requested:assessments[0]?.id||'';
    if(selectedId)sessionStorage.setItem('arl_selected_assessment',selectedId);
    render();
    if(selectedId)await loadScans();
  }catch(error){
    if(error.message.includes('Sign in'))location.href=`/auth.html?next=${encodeURIComponent('/inspector.html')}`;
    else fail(error.message);
  }
}

function render(){
  const selected=assessments.find(item=>item.id===selectedId);
  root.className='';
  root.innerHTML=`
    <section class="workspace-agent-command">
      <div class="workspace-agent-command-head"><div class="workspace-agent-identity"><span class="eyebrow">Assessment context</span><h2>${selected?escapeHtml(selected.name):'No assessment selected'}</h2><p>${selected?`${escapeHtml(selected.agent_type)} · ${new Date(selected.created_at).toLocaleDateString('en-GB')}`:'Create an assessment before collecting technical evidence.'}</p></div>${assessments.length?`<div class="workspace-agent-selector"><label for="assessmentSelect">Attach evidence to</label><select id="assessmentSelect">${assessments.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===selectedId?'selected':''}>${escapeHtml(a.name)} · ${escapeHtml(a.agent_type)}</option>`).join('')}</select></div>`:''}</div>
      ${selected?`<div class="workspace-status-grid"><div class="workspace-status-card" data-state="unresolved"><small>Evidence class</small><strong>Observed</strong><p>Inspector results remain separate from declared assessment answers.</p></div><div class="workspace-status-card" data-state="unresolved"><small>Trust boundary</small><strong>Read-only local scan</strong><p>Source code and secret values are excluded from the uploaded evidence bundle.</p></div><div class="workspace-next-action"><small>Next action</small><strong>Run the authorised Inspector against the exact system version.</strong><p>The one-time upload token expires and can be used once.</p><button class="button primary small" id="createToken">Create inspection command</button></div></div>`:''}
    </section>
    ${selected?'<div id="commandBox"></div>':'<div class="workspace-empty section-gap">Create and save an assessment first.<br><br><a class="button primary" href="/assessment.html">Start assessment</a></div>'}
    <div class="workspace-content-grid section-gap">
      <section class="workspace-section"><div class="workspace-section-heading"><div><span class="eyebrow">Evidence history</span><h2>Completed inspections</h2><p>Evidence stays linked to the selected assessment and scanner release.</p></div><button class="button ghost small" id="refreshScans">Refresh</button></div><div id="scanList" class="loading">${selected?'Loading inspections…':'Choose an assessment to load inspections.'}</div></section>
      <aside><details class="workspace-technical" open><summary><span>Inspector trust boundary</span><small>What leaves the machine</small></summary><div class="workspace-technical-body"><h3>Uploaded</h3><ul class="check-list"><li>Rule result, severity and remediation</li><li>File basename, path hash and optional line number</li><li>Scanner scope, version and cryptographic digest</li><li>Technology inventory and bounded counts</li></ul><h3>Not uploaded</h3><ul class="check-list"><li>Source-code content</li><li>Matched passwords, tokens or private keys</li><li>Environment-variable values</li><li>Customer files or prompts</li></ul><a class="button ghost full" href="/downloads/agent-risk-inspector.mjs" download>Download Inspector</a><a class="button ghost full" href="/downloads/agent-risk-inspector.mjs.sha256">View SHA-256 checksum</a><a class="button ghost full" href="/inspector-policy.json" target="_blank" rel="noopener">Review policy catalogue</a><p class="microcopy">The upload service checks the reported scanner digest against the published release. This detects ordinary release mismatch but is not remote attestation of the customer machine.</p></div></details></aside>
    </div>`;
  document.querySelector('#assessmentSelect')?.addEventListener('change',async e=>{
    selectedId=e.target.value;
    sessionStorage.setItem('arl_selected_assessment',selectedId);
    history.replaceState({},'',`/inspector.html?assessment=${encodeURIComponent(selectedId)}`);
    render();
    await loadScans();
  });
  document.querySelector('#createToken')?.addEventListener('click',createToken);
  document.querySelector('#refreshScans')?.addEventListener('click',loadScans);
  syncTokenButton();
  scheduleTokenExpiry();
}

async function createToken(event){
  if(!selectedId||tokenIsValidForSelected()){
    syncTokenButton();
    return;
  }
  const button=event.currentTarget;
  setBusy(button,true,'Creating…');
  try{
    const item=await api('/api/inspector/tokens',{method:'POST',body:JSON.stringify({assessmentId:selectedId})});
    const command=`curl -fsSLO ${location.origin}/downloads/agent-risk-inspector.mjs\ncurl -fsSLO ${location.origin}/downloads/agent-risk-inspector.mjs.sha256\nsha256sum -c agent-risk-inspector.mjs.sha256\nnode agent-risk-inspector.mjs scan . --authorised --environment production --upload ${location.origin} --token ${item.token} --out agentrisk-inspection.json`;
    activeTokenState={assessmentId:selectedId,expiresAt:item.expiresAt,command};
    document.querySelector('#commandBox').innerHTML=`<section class="workspace-section section-gap"><div class="success-box">One-time token created. It expires ${new Date(item.expiresAt).toLocaleTimeString('en-GB')} and can be used once.</div><h2>Run against the exact assessed project</h2><ol><li>Open a terminal in the project folder.</li><li>Review the command. It downloads the public scanner and checksum, verifies the release, then runs the authorised scan.</li><li>Run the complete block:</li></ol><pre id="scanCommand">${escapeHtml(command)}</pre><button class="button ghost small" id="copyCommand">Copy command</button><p class="microcopy">The <code>--authorised</code> flag confirms you own the system or have explicit permission to inspect it. Treat the one-time token like a password until it expires.</p></section>`;
    document.querySelector('#copyCommand').addEventListener('click',()=>navigator.clipboard.writeText(command).then(()=>alert('Command copied.')));
  }catch(error){
    alert(error.message);
  }finally{
    setBusy(button,false);
    syncTokenButton();
    scheduleTokenExpiry();
  }
}

async function loadScans(){
  const list=document.querySelector('#scanList');
  if(!list)return;
  if(!selectedId){list.innerHTML='<p class="muted">No assessment selected.</p>';return}
  list.className='loading';list.textContent='Loading inspections…';
  try{
    const{inspections}=await api(`/api/assessments/${encodeURIComponent(selectedId)}/inspections`);
    list.className='scan-list';
    list.innerHTML=inspections.length?inspections.map(scanHtml).join(''):'<div class="workspace-empty">No inspection uploaded for this assessment yet.</div>';
    document.querySelectorAll('[data-inspection]').forEach(b=>b.addEventListener('click',openInspection));
  }catch(error){list.className='error-box show';list.textContent=error.message}
}

function scanHtml(x){const s=x.summary;return `<article class="scan-row"><div><div class="scan-title"><strong>Posture ${s.postureScore}/100 · Grade ${escapeHtml(s.grade)}</strong><span class="severity ${s.counts.critical?'critical':s.counts.high?'high':s.counts.medium?'medium':'low'}">${s.counts.critical?'critical':s.counts.high?'high':s.counts.medium?'medium':'clear'}</span></div><div class="assessment-meta"><span>${new Date(x.createdAt).toLocaleString('en-GB')}</span><span>Scanner ${escapeHtml(x.scannerVersion)}</span><span>${s.findingsTotal} findings</span><span>${s.counts.critical} critical · ${s.counts.high} high</span>${x.delta?.status&&x.delta.status!=='first-scan'?`<span>${x.delta.postureChange>=0?'+':''}${x.delta.postureChange} posture change</span>`:''}</div></div><button class="button ghost small" data-inspection="${escapeHtml(x.id)}">View evidence</button></article>`}
function openInspection(event){const id=event.currentTarget.dataset.inspection;if(id)location.href=`/inspection-detail.html?id=${encodeURIComponent(id)}`}
function fail(message){root.className='panel';root.innerHTML=`<div class="error-box show">${escapeHtml(message)}</div>`}

init();
