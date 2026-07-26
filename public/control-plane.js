import { api, escapeHtml, setBusy, showError } from './shared.js';

const root = document.querySelector('#controlPlaneRoot');
const errorBox = document.querySelector('#controlPlaneError');
let overview = null;
let project = null;
let selectedProjectId = sessionStorage.getItem('arl_selected_project') || '';
let revealedKey = '';

const severityOrder = { critical: 1, high: 2, medium: 3, low: 4, none: 5 };

document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  location.href = '/';
});

init();

async function init() {
  try {
    await loadOverview();
    if (selectedProjectId && overview.projects.some((item) => item.id === selectedProjectId)) await loadProject(selectedProjectId);
    else if (overview.projects[0]) await loadProject(overview.projects[0].id);
    render();
  } catch (error) {
    if (/sign in/i.test(error.message)) location.href = `/auth.html?next=${encodeURIComponent('/control-plane.html')}`;
    else fail(error);
  }
}

async function loadOverview() {
  overview = await api('/api/control-plane/overview');
}

async function loadProject(projectId) {
  project = (await api(`/api/projects/${encodeURIComponent(projectId)}`)).project;
  selectedProjectId = projectId;
  sessionStorage.setItem('arl_selected_project', projectId);
}

function render() {
  root.className = '';
  root.innerHTML = `
    ${overviewHeader()}
    <div class="control-plane-layout">
      <aside class="project-rail">
        <div class="rail-heading"><span class="eyebrow">Projects</span><small>${overview.projects.length}/${overview.entitlement.projects} active allowance</small></div>
        <div class="project-list">${overview.projects.map(projectButton).join('') || '<p class="muted small-copy">No security projects yet.</p>'}</div>
        <form id="createProject" class="mini-form rail-form">
          <label for="projectName">New security project</label>
          <input id="projectName" name="name" required minlength="2" maxlength="100" placeholder="Customer support agent">
          <select id="projectEnvironment" name="environment"><option value="development">Development</option><option value="test">Test</option><option value="staging">Staging</option><option value="production">Production</option></select>
          <button class="button primary small" type="submit">Create project</button>
        </form>
        <div class="entitlement-card"><strong>${escapeHtml(overview.entitlement.name)}</strong><span>${formatNumber(overview.entitlement.runtimeRequestsPerMonth)} runtime checks/month</span><span>${overview.entitlement.retentionDays}-day event retention</span><a href="/pricing.html">Compare plans →</a></div>
      </aside>
      <section class="control-plane-main">${project ? projectView() : emptyProject()}</section>
    </div>`;
  bind();
}

function overviewHeader() {
  const totals = overview.totals;
  return `<section class="control-overview">
    <article><span>Security projects</span><strong>${totals.projects}</strong><small>Scoped by workspace</small></article>
    <article><span>Runtime checks this month</span><strong>${formatNumber(totals.runtimeRequestsMonth)}</strong><small>${formatPercent(totals.deniedMonth, totals.runtimeRequestsMonth)} denied</small></article>
    <article><span>Threats blocked</span><strong>${formatNumber(totals.deniedMonth)}</strong><small>Policy-enforced decisions</small></article>
    <article><span>Open remediation</span><strong>${formatNumber(totals.openRemediations)}</strong><small>Owned, tracked and retestable</small></article>
  </section>`;
}

function projectButton(item) {
  const active = item.id === selectedProjectId ? 'active' : '';
  return `<button class="project-button ${active}" data-project-id="${escapeHtml(item.id)}">
    <span class="project-icon">${escapeHtml(item.name.slice(0, 2).toUpperCase())}</span>
    <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.environment)} · ${formatNumber(item.runtimeRequestsMonth)} checks</small></span>
    <i class="project-health ${item.deniedMonth ? 'warning' : ''}"></i>
  </button>`;
}

function emptyProject() {
  return `<section class="panel empty-state"><span class="eyebrow">Start here</span><h2>Create the security boundary for your first AI system.</h2><p>A project owns its runtime policy, API keys, inventory snapshots, drift history, remediation work and security audit trail.</p></section>`;
}

function projectView() {
  const usage = project.entitlement.usage;
  const latestInventory = project.inventory[0] || null;
  const openItems = project.remediations.filter((item) => !['verified', 'closed'].includes(item.status));
  return `
    <section class="panel project-command-header">
      <div><span class="eyebrow">${escapeHtml(project.environment)} · ${escapeHtml(project.role)}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.slug)} · policy v${escapeHtml(project.policyVersion)} · ${project.retentionDays}-day event retention</p></div>
      <div class="command-status"><span>${project.policy.mode === 'enforce' ? 'Enforcing' : 'Monitoring'}</span><strong>${formatNumber(usage.requests)} / ${formatNumber(project.entitlement.runtimeRequestsPerMonth)}</strong><small>runtime checks this month</small></div>
    </section>
    <nav class="control-tabs" aria-label="Project sections"><a href="#runtime">Runtime</a><a href="#policy">Policy</a><a href="#inventory">Inventory</a><a href="#remediation">Remediation</a><a href="#audit">Audit</a></nav>
    <section id="runtime" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Runtime API</span><h2>Screen every agent step.</h2></div><button id="createKeyButton" class="button primary small" ${project.permissions.rotateKeys ? '' : 'disabled'}>Issue API key</button></div>
      ${revealedKey ? oneTimeKey(revealedKey) : ''}
      <div class="runtime-grid">
        <article class="panel"><h3>Integration request</h3><p class="muted">Send input, output and tool context. The response returns allow or deny with precise rule evidence. Raw content is never stored.</p><pre><code>${escapeHtml(curlExample())}</code></pre><button class="button ghost small" data-copy="curl">Copy example</button></article>
        <article class="panel"><h3>Active API keys</h3><div class="key-list">${project.apiKeys.length ? project.apiKeys.map(keyRow).join('') : '<p class="muted">No API key yet. Issue one to integrate a staging system.</p>'}</div></article>
      </div>
      <article class="panel section-gap"><div class="section-heading compact-heading"><div><h3>Recent security decisions</h3><p class="muted">Only digests, rule identifiers, bounded metadata and timing are retained.</p></div><span class="status-pill">${project.events.length} recent</span></div>${eventTable(project.events)}</article>
    </section>
    <section id="policy" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Policy as control</span><h2>Define what the agent may do.</h2></div></div>
      ${policyForm()}
    </section>
    <section id="inventory" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Continuous posture</span><h2>Detect attack-surface drift.</h2></div></div>
      <div class="runtime-grid"><article class="panel"><h3>Record inventory snapshot</h3><p class="muted">Paste a deployment manifest or configuration export. AgentRiskLayer stores the derived asset inventory, not credentials.</p><form id="inventoryForm" class="auth-form"><div class="field"><label for="inventorySource">Source label</label><input id="inventorySource" value="deployment-manifest" maxlength="40"></div><div class="field"><label for="inventoryJson">JSON manifest</label><textarea id="inventoryJson" rows="12" required placeholder='{"agent":{"name":"support-agent","model":"gpt-4.1","environment":"staging","tools":[{"kind":"tool","name":"crm.read"}]}}'></textarea></div><button class="button primary" type="submit">Analyse and compare</button></form></article><article class="panel"><h3>Latest posture</h3>${latestInventory ? inventorySummary(latestInventory) : '<div class="empty-state"><p>No inventory snapshot yet.</p></div>'}</article></div>
      ${project.inventory.length ? `<article class="panel section-gap"><h3>Inventory history</h3>${inventoryHistory(project.inventory)}</article>` : ''}
    </section>
    <section id="remediation" class="control-section">
      <div class="section-heading compact-heading"><div><span class="eyebrow">Close the loop</span><h2>Own, fix and retest.</h2></div><span class="status-pill">${openItems.length} open</span></div>
      <div class="runtime-grid"><article class="panel"><h3>Create remediation item</h3><form id="remediationForm" class="auth-form"><div class="field"><label for="remediationTitle">Required control or fix</label><input id="remediationTitle" required maxlength="240" placeholder="Remove shell access from support agent"></div><div class="form-grid"><div class="field"><label for="remediationSeverity">Severity</label><select id="remediationSeverity"><option>critical</option><option>high</option><option selected>medium</option><option>low</option></select></div><div class="field"><label for="remediationOwner">Owner email</label><input id="remediationOwner" type="email" placeholder="security@company.com"></div></div><button class="button primary" type="submit">Add remediation</button></form></article><article class="panel"><h3>Remediation queue</h3><div class="remediation-list">${project.remediations.length ? project.remediations.map(remediationRow).join('') : '<p class="muted">No remediation work recorded.</p>'}</div></article></div>
    </section>
    <section id="audit" class="control-section"><div class="section-heading compact-heading"><div><span class="eyebrow">Tamper-evident operations</span><h2>Security audit trail.</h2></div></div><article class="panel">${auditTable(project.audit)}</article></section>`;
}

function policyForm() {
  const p = project.policy;
  return `<form id="policyForm" class="panel policy-editor">
    <div class="policy-mode"><label><input type="radio" name="mode" value="monitor" ${p.mode === 'monitor' ? 'checked' : ''}><span><strong>Monitor</strong><small>Return allow but report what policy would deny.</small></span></label><label><input type="radio" name="mode" value="enforce" ${p.mode === 'enforce' ? 'checked' : ''}><span><strong>Enforce</strong><small>Denied requests must not reach the model, tool or user.</small></span></label></div>
    <div class="form-grid policy-fields"><div class="field"><label for="allowedTools">Allowed tools</label><input id="allowedTools" value="${escapeHtml((p.allowedTools || []).join(', '))}" placeholder="crm.read, tickets.search"></div><div class="field"><label for="deniedTools">Denied tools</label><input id="deniedTools" value="${escapeHtml((p.deniedTools || []).join(', '))}" placeholder="shell, exec, delete"></div><div class="field"><label for="allowedHosts">Allowed network hosts</label><input id="allowedHosts" value="${escapeHtml((p.allowedHosts || []).join(', '))}" placeholder="api.company.com"></div><div class="field"><label for="approvalActions">Human approval required for</label><input id="approvalActions" value="${escapeHtml((p.requireApprovalFor || []).join(', '))}" placeholder="write, send, payment, deploy"></div></div>
    <div class="policy-switches"><label><input id="inspectInput" type="checkbox" ${p.inspectInput !== false ? 'checked' : ''}> Inspect prompts and external context</label><label><input id="inspectOutput" type="checkbox" ${p.inspectOutput !== false ? 'checked' : ''}> Inspect model output</label><label><input id="blockSecrets" type="checkbox" ${p.blockSecretLikeValues !== false ? 'checked' : ''}> Block secret-like tool arguments</label></div>
    <div class="button-row"><button class="button primary" type="submit" ${project.permissions.manage ? '' : 'disabled'}>Publish policy version</button><span class="muted small-copy">All changes are versioned in the project audit trail.</span></div>
  </form>`;
}

function oneTimeKey(value) {
  return `<div class="one-time-key"><div><strong>Copy this key now.</strong><span>It will never be shown again.</span></div><pre>${escapeHtml(value)}</pre><button class="button primary small" data-copy="key">Copy key</button></div>`;
}

function keyRow(key) {
  const status = key.revoked_at ? 'revoked' : key.expires_at && Date.parse(key.expires_at) < Date.now() ? 'expired' : 'active';
  return `<div class="key-row"><div><strong>${escapeHtml(key.name)}</strong><span>arl_live_${escapeHtml(key.key_prefix)}_••••••••</span><small>Created ${date(key.created_at)}${key.last_used_at ? ` · last used ${dateTime(key.last_used_at)}` : ' · never used'}</small></div><div><span class="status-dot ${status}">${status}</span>${status === 'active' && project.permissions.rotateKeys ? `<button class="icon-button" title="Revoke key" data-revoke-key="${escapeHtml(key.id)}">×</button>` : ''}</div></div>`;
}

function eventTable(events) {
  if (!events.length) return '<div class="empty-state"><p>No runtime requests have been screened.</p></div>';
  return `<div class="data-table"><div class="data-table-head"><span>Decision</span><span>Request</span><span>Surface</span><span>Rules</span><span>Latency</span><span>Time</span></div>${events.map((event) => `<div class="data-table-row"><span><b class="decision-chip ${event.decision}">${escapeHtml(event.decision)}</b></span><span><code>${escapeHtml(event.request_id)}</code></span><span>${escapeHtml(event.tool_name || 'content')}</span><span>${event.ruleIds.length ? event.ruleIds.map((id) => `<small class="rule-chip">${escapeHtml(id)}</small>`).join('') : '<small class="safe-text">clean</small>'}</span><span>${Number(event.evaluation_ms).toFixed(2)} ms</span><span>${dateTime(event.created_at)}</span></div>`).join('')}</div>`;
}

function inventorySummary(snapshot) {
  const d = snapshot.drift || {};
  return `<div class="inventory-score"><strong>${snapshot.summary.total || 0}</strong><span>AI assets discovered</span></div><div class="inventory-metrics"><div><b>${snapshot.summary.production || 0}</b><span>Production</span></div><div><b>${snapshot.summary.internetExposed || 0}</b><span>Internet exposed</span></div><div><b>${snapshot.summary.privileged || 0}</b><span>Privileged</span></div></div><div class="drift-banner ${d.deploymentGate === 'review-required' ? 'warning' : 'clear'}"><strong>${d.deploymentGate === 'review-required' ? 'Deployment review required' : 'No risky exposure drift'}</strong><span>${d.added?.length || 0} added · ${d.removed?.length || 0} removed · ${d.changed?.length || 0} changed</span></div><div class="asset-list">${snapshot.assets.slice(0, 12).map((asset) => `<div><span class="asset-kind">${escapeHtml(asset.kind)}</span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.provider)} · ${escapeHtml(asset.environment)}${asset.privileged ? ' · privileged' : ''}${asset.internetExposed ? ' · public' : ''}</small></div>`).join('')}</div>`;
}

function inventoryHistory(items) {
  return items.map((item) => `<div class="history-row"><span>${dateTime(item.createdAt)}</span><strong>${item.summary.total || 0} assets</strong><span>${item.drift.added?.length || 0} added</span><span>${item.drift.changed?.length || 0} changed</span><span class="status-dot ${item.drift.deploymentGate === 'review-required' ? 'warning' : 'active'}">${escapeHtml(item.drift.deploymentGate || 'clear')}</span></div>`).join('');
}

function remediationRow(item) {
  return `<div class="remediation-row"><span class="severity-bar ${escapeHtml(item.severity)}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.finding_key)}${item.owner_email ? ` · ${escapeHtml(item.owner_email)}` : ''}</small></div><select data-remediation-status="${escapeHtml(item.id)}" aria-label="Status for ${escapeHtml(item.title)}"><option value="open" ${item.status === 'open' ? 'selected' : ''}>Open</option><option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="ready_for_retest" ${item.status === 'ready_for_retest' ? 'selected' : ''}>Ready for retest</option><option value="verified" ${item.status === 'verified' ? 'selected' : ''}>Verified</option><option value="accepted_risk" ${item.status === 'accepted_risk' ? 'selected' : ''}>Accepted risk</option><option value="closed" ${item.status === 'closed' ? 'selected' : ''}>Closed</option></select></div>`;
}

function auditTable(items) {
  if (!items.length) return '<p class="muted">No project audit events yet.</p>';
  return `<div class="audit-list">${items.map((item) => `<div><span class="audit-icon">${auditIcon(item.action)}</span><span><strong>${escapeHtml(item.action.replaceAll('.', ' '))}</strong><small>${escapeHtml(item.actor_type)} · ${dateTime(item.created_at)}</small></span><code>${escapeHtml(item.target_id || item.project_id || '')}</code></div>`).join('')}</div>`;
}

function bind() {
  document.querySelectorAll('[data-project-id]').forEach((button) => button.addEventListener('click', async () => {
    try { await loadProject(button.dataset.projectId); revealedKey = ''; render(); } catch (error) { fail(error); }
  }));
  document.querySelector('#createProject')?.addEventListener('submit', createProject);
  document.querySelector('#createKeyButton')?.addEventListener('click', createKey);
  document.querySelector('#policyForm')?.addEventListener('submit', savePolicy);
  document.querySelector('#inventoryForm')?.addEventListener('submit', saveInventory);
  document.querySelector('#remediationForm')?.addEventListener('submit', createRemediation);
  document.querySelectorAll('[data-revoke-key]').forEach((button) => button.addEventListener('click', revokeKey));
  document.querySelectorAll('[data-remediation-status]').forEach((select) => select.addEventListener('change', updateRemediation));
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', copyValue));
}

async function createProject(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Creating…');
  try {
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#projectName').value, environment: document.querySelector('#projectEnvironment').value }) });
    await loadOverview(); await loadProject(result.project.id); render();
  } catch (error) { fail(error); setBusy(button, false); }
}

async function createKey(event) {
  setBusy(event.currentTarget, true, 'Issuing…');
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/keys`, { method: 'POST', body: JSON.stringify({ name: `Runtime key ${project.apiKeys.length + 1}` }) });
    revealedKey = result.key.token;
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); setBusy(event.currentTarget, false); }
}

async function revokeKey(event) {
  if (!confirm('Revoke this API key immediately? Requests using it will be rejected.')) return;
  try { await api(`/api/projects/${encodeURIComponent(project.id)}/keys/${encodeURIComponent(event.currentTarget.dataset.revokeKey)}/revoke`, { method: 'POST', body: '{}' }); await loadProject(project.id); render(); } catch (error) { fail(error); }
}

async function savePolicy(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'Publishing…');
  const policy = {
    mode: new FormData(event.currentTarget).get('mode'),
    allowedTools: csv(document.querySelector('#allowedTools').value),
    deniedTools: csv(document.querySelector('#deniedTools').value),
    allowedHosts: csv(document.querySelector('#allowedHosts').value),
    requireApprovalFor: csv(document.querySelector('#approvalActions').value),
    inspectInput: document.querySelector('#inspectInput').checked,
    inspectOutput: document.querySelector('#inspectOutput').checked,
    blockSecretLikeValues: document.querySelector('#blockSecrets').checked,
  };
  try { project = (await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ policy }) })).project; await loadOverview(); render(); } catch (error) { fail(error); setBusy(button, false); }
}

async function saveInventory(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Analysing…');
  try {
    const documents = JSON.parse(document.querySelector('#inventoryJson').value);
    await api(`/api/projects/${encodeURIComponent(project.id)}/inventory`, { method: 'POST', body: JSON.stringify({ source: document.querySelector('#inventorySource').value, documents }) });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error instanceof SyntaxError ? new Error('Inventory must be valid JSON.') : error); setBusy(button, false); }
}

async function createRemediation(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'Adding…');
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/remediations`, { method: 'POST', body: JSON.stringify({ title: document.querySelector('#remediationTitle').value, severity: document.querySelector('#remediationSeverity').value, ownerEmail: document.querySelector('#remediationOwner').value }) });
    await loadProject(project.id); await loadOverview(); render();
  } catch (error) { fail(error); setBusy(button, false); }
}

async function updateRemediation(event) {
  event.currentTarget.disabled = true;
  try { await api(`/api/projects/${encodeURIComponent(project.id)}/remediations/${encodeURIComponent(event.currentTarget.dataset.remediationStatus)}`, { method: 'PATCH', body: JSON.stringify({ status: event.currentTarget.value }) }); await loadProject(project.id); await loadOverview(); render(); } catch (error) { fail(error); event.currentTarget.disabled = false; }
}

async function copyValue(event) {
  const value = event.currentTarget.dataset.copy === 'key' ? revealedKey : curlExample();
  await navigator.clipboard.writeText(value);
  const original = event.currentTarget.textContent;
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => { event.currentTarget.textContent = original; }, 1200);
}

function curlExample() {
  return `curl -sS https://agentrisklayer.com/v1/guard \\\n  -H "Authorization: Bearer ${revealedKey || 'arl_live_YOUR_KEY'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "request_id": "agent-step-123",\n    "input": "Customer request and retrieved context",\n    "tool_call": {\n      "name": "crm.read",\n      "arguments": {"customer_id": "cust_123"},\n      "context": {"environment": "${project.environment}"}\n    },\n    "metadata": {"application": "support-agent"}\n  }'`;
}

function fail(error) {
  showError(errorBox, error.message || 'Unexpected error.');
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function csv(value) { return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))]; }
function formatNumber(value) { return new Intl.NumberFormat('en-GB').format(Number(value || 0)); }
function formatPercent(part, total) { return total ? `${((Number(part) / Number(total)) * 100).toFixed(1)}%` : '0%'; }
function date(value) { return value ? new Date(value).toLocaleDateString('en-GB') : '—'; }
function dateTime(value) { return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function auditIcon(action) { return action.includes('denied') ? '!' : action.includes('key') ? '⌘' : action.includes('inventory') ? '◇' : action.includes('policy') ? '⚙' : '✓'; }
