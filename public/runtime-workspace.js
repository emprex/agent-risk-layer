import { api } from './shared.js';

const root = document.querySelector('#controlPlaneRoot');
let inventorySyncTimer = null;
let inventorySyncKey = '';

function currentTechnicalDecisionPanel() {
  return [...document.querySelectorAll('#technicalControls article.panel')]
    .find((panel) => panel.querySelector('h3')?.textContent?.trim() === 'Technical decision evidence') || null;
}

function latestAccessPanel() {
  return [...document.querySelectorAll('#inventory article.panel')]
    .find((panel) => panel.querySelector('h3')?.textContent?.trim() === 'Latest access picture') || null;
}

function currentProjectId() {
  return document.querySelector('[data-project-id].active')?.dataset.projectId
    || sessionStorage.getItem('arl_selected_project')
    || '';
}

function evidenceStatus(asset, field, legacyValueField) {
  const status = asset?.[field];
  if (status === 'known-true' || status === 'known-false' || status === 'unknown') return status;
  if (asset?.[legacyValueField] === true) return 'known-true';
  return 'unknown';
}

function updateMetric(panel, labelText, confirmed, unknown, total) {
  const metric = [...panel.querySelectorAll('.inventory-metrics > div')]
    .find((item) => item.querySelector('span')?.textContent?.trim() === labelText);
  if (!metric) return;
  const value = metric.querySelector('b');
  const label = metric.querySelector('span');
  if (value) value.textContent = unknown ? `${confirmed} confirmed` : String(confirmed);
  if (label) label.textContent = labelText;
  let note = metric.querySelector('.inventory-evidence-note');
  if (!note) {
    note = document.createElement('small');
    note.className = 'inventory-evidence-note';
    metric.append(note);
  }
  note.textContent = unknown
    ? `${unknown} of ${total} status${unknown === 1 ? '' : 'es'} unknown · evidence required`
    : `Status evidenced for all ${total} discovered asset${total === 1 ? '' : 's'}`;
}

function updateAssetEvidence(panel, assets) {
  const rows = [...panel.querySelectorAll('.asset-list > div')];
  rows.forEach((row, index) => {
    const asset = assets[index];
    if (!asset) return;
    const privilege = evidenceStatus(asset, 'privilegeStatus', 'privileged');
    const exposure = evidenceStatus(asset, 'internetExposureStatus', 'internetExposed');
    let note = row.querySelector('.asset-evidence-state');
    if (!note) {
      note = document.createElement('small');
      note.className = 'asset-evidence-state';
      row.append(note);
    }
    const privilegeLabel = privilege === 'known-true' ? 'privilege confirmed'
      : privilege === 'known-false' ? 'not privileged confirmed'
        : 'privilege unknown';
    const exposureLabel = exposure === 'known-true' ? 'internet exposure confirmed'
      : exposure === 'known-false' ? 'not internet exposed confirmed'
        : 'internet exposure unknown';
    note.textContent = `${privilegeLabel} · ${exposureLabel}`;
  });
}

function applyInventoryEvidence(panel, snapshot) {
  const assets = Array.isArray(snapshot?.assets) ? snapshot.assets : [];
  if (!assets.length) return;
  const total = assets.length;
  const privilegeStatuses = assets.map((asset) => evidenceStatus(asset, 'privilegeStatus', 'privileged'));
  const exposureStatuses = assets.map((asset) => evidenceStatus(asset, 'internetExposureStatus', 'internetExposed'));
  const privileged = privilegeStatuses.filter((status) => status === 'known-true').length;
  const privilegeUnknown = privilegeStatuses.filter((status) => status === 'unknown').length;
  const exposed = exposureStatuses.filter((status) => status === 'known-true').length;
  const exposureUnknown = exposureStatuses.filter((status) => status === 'unknown').length;

  updateMetric(panel, 'Privileged', privileged, privilegeUnknown, total);
  updateMetric(panel, 'Internet exposed', exposed, exposureUnknown, total);
  updateAssetEvidence(panel, assets);

  const evidenceIncomplete = privilegeUnknown > 0 || exposureUnknown > 0;
  let notice = panel.querySelector('.inventory-evidence-gap');
  if (evidenceIncomplete) {
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'drift-banner warning inventory-evidence-gap';
      const metrics = panel.querySelector('.inventory-metrics');
      metrics?.insertAdjacentElement('afterend', notice);
    }
    notice.innerHTML = `<strong>Exposure evidence incomplete</strong><span>${privilegeUnknown} privilege · ${exposureUnknown} internet-exposure status${privilegeUnknown + exposureUnknown === 1 ? '' : 'es'} unknown. Unknown is neither treated as safe nor turned into a finding.</span>`;
  } else if (notice) {
    notice.remove();
  }

  const drift = panel.querySelector('.drift-banner:not(.inventory-evidence-gap)');
  if (drift?.classList.contains('clear') && evidenceIncomplete) {
    drift.querySelector('strong')?.replaceChildren(document.createTextNode('No confirmed risky exposure drift'));
  }
}

async function syncInventoryEvidence() {
  const panel = latestAccessPanel();
  const projectId = currentProjectId();
  if (!panel || !projectId) return;
  try {
    const payload = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    const snapshot = payload.project?.inventory?.[0];
    if (!snapshot) return;
    const key = `${projectId}:${snapshot.id || snapshot.createdAt || 'latest'}:${JSON.stringify(snapshot.assets || []).length}`;
    if (key === inventorySyncKey && panel.dataset.inventoryEvidenceApplied === key) return;
    inventorySyncKey = key;
    applyInventoryEvidence(panel, snapshot);
    panel.dataset.inventoryEvidenceApplied = key;
  } catch {
    // The base Runtime page remains usable if evidence enrichment cannot be loaded.
  }
}

function scheduleInventoryEvidenceSync() {
  clearTimeout(inventorySyncTimer);
  inventorySyncTimer = setTimeout(syncInventoryEvidence, 80);
}

function syncRuntimeWorkspace() {
  const technical = document.querySelector('#technicalControls');
  document.body.classList.toggle('runtime-specialist-active', Boolean(technical));
  if (!technical) return;

  const decisionPanel = currentTechnicalDecisionPanel();
  if (decisionPanel && !decisionPanel.id) decisionPanel.id = 'decisionEvidence';

  const commandHeader = technical.querySelector('.project-command-header');
  if (commandHeader && !commandHeader.querySelector('[data-runtime-guided-back]')) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'button ghost small runtime-guided-back';
    back.dataset.runtimeGuidedBack = 'true';
    back.textContent = 'Back to simple runtime view';
    back.addEventListener('click', () => {
      const existingToggle = document.querySelector('#toggleTechnicalMode');
      if (existingToggle) {
        existingToggle.click();
      } else {
        sessionStorage.setItem('arl_control_plane_mode', 'guided');
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        location.reload();
      }
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    });
    commandHeader.append(back);
  }
  scheduleInventoryEvidenceSync();
}

function focusDecisionEvidence() {
  requestAnimationFrame(() => {
    syncRuntimeWorkspace();
    const decisionPanel = document.querySelector('#decisionEvidence') || currentTechnicalDecisionPanel();
    if (!decisionPanel) return;
    if (!decisionPanel.id) decisionPanel.id = 'decisionEvidence';
    history.replaceState(null, '', '#decisionEvidence');
    decisionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

if (root) {
  new MutationObserver(syncRuntimeWorkspace).observe(root, { childList: true, subtree: true });
  syncRuntimeWorkspace();
}

document.addEventListener('click', (event) => {
  const evidenceButton = event.target.closest('.plain-activity [data-open-technical="runtime"]');
  if (evidenceButton) setTimeout(focusDecisionEvidence, 0);
});

if (location.hash === '#decisionEvidence') {
  setTimeout(focusDecisionEvidence, 0);
}
