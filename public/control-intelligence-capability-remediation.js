import { api, qs } from './shared.js';
import {
  CAPABILITY_PROFILE_VERSION,
  CAPABILITY_DIMENSIONS,
  CAPABILITY_MULTI_DIMENSIONS,
  deriveCapabilityFacts,
  normaliseCapabilityProfile,
} from './agent-capability-profile.js';

const projectId = qs('projectId');
const controlId = qs('controlId');
let detailCache = null;
let decorating = false;

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function message(value, error = false) {
  const box = document.querySelector('#ciMessage');
  if (!box) return;
  box.className = error ? 'error-box show' : 'success-box show';
  box.textContent = value;
  box.setAttribute('tabindex', '-1');
  box.focus({ preventScroll: true });
}

function capabilityFields(input = {}) {
  const profile = normaliseCapabilityProfile(input);
  return `<fieldset class="ci-capability-profile" data-capability-remediation><legend>Agent Capability Profile <code>${CAPABILITY_PROFILE_VERSION}</code></legend><p class="ci-field-help">Confirm the capabilities of the remediated system. Capabilities and unknowns are context, not findings. They become security findings only when an observed or reproducible failure supports one.</p>${CAPABILITY_DIMENSIONS.map((dimension) => `<label>${esc(dimension.label)}<select name="remediation-capability-${esc(dimension.key)}">${dimension.options.map(([value,label]) => `<option value="${esc(value)}" ${profile[dimension.key] === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`).join('')}${CAPABILITY_MULTI_DIMENSIONS.map((dimension) => `<fieldset><legend>${esc(dimension.label)}</legend><div class="ci-check-grid">${dimension.options.map(([value,label]) => `<label><input type="checkbox" name="remediation-capability-${esc(dimension.key)}" value="${esc(value)}" ${profile[dimension.key].includes(value) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div></fieldset>`).join('')}</fieldset>`;
}

function readProfile(form) {
  const raw = {};
  for (const dimension of CAPABILITY_DIMENSIONS) raw[dimension.key] = form.elements[`remediation-capability-${dimension.key}`]?.value;
  for (const dimension of CAPABILITY_MULTI_DIMENSIONS) raw[dimension.key] = [...form.querySelectorAll(`[name="remediation-capability-${dimension.key}"]:checked`)].map((node) => node.value);
  return normaliseCapabilityProfile(raw);
}

function manualFacts(snapshot) {
  const config = snapshot?.assessmentConfiguration || {};
  if (Array.isArray(config.manualArchitectureFacts)) return [...config.manualArchitectureFacts];
  const previousProfile = config.capabilityProfile;
  if (!previousProfile) return Array.isArray(config.architectureFacts) ? [...config.architectureFacts] : [];
  const derived = new Set(deriveCapabilityFacts(previousProfile));
  return (Array.isArray(config.architectureFacts) ? config.architectureFacts : []).filter((fact) => !derived.has(fact));
}

function assessmentConfiguration(snapshot, profile) {
  const existing = snapshot.assessmentConfiguration || {};
  const manual = [...new Set(manualFacts(snapshot))].sort();
  const architectureFacts = [...new Set([...manual, ...deriveCapabilityFacts(profile)])].sort();
  return {
    ...existing,
    architectureFacts,
    manualArchitectureFacts: manual,
    capabilityProfile: normaliseCapabilityProfile(profile),
    confirmed: true,
  };
}

async function loadDetail() {
  if (!projectId || !controlId) return null;
  detailCache = await api(`/api/projects/${encodeURIComponent(projectId)}/control-intelligence/controls/${encodeURIComponent(controlId)}`);
  return detailCache;
}

async function decorate() {
  if (decorating) return;
  const form = document.querySelector('#ciControlRoot #snapshotForm');
  if (!form || form.dataset.capabilityProfileReady === 'true') return;
  decorating = true;
  try {
    const detail = detailCache || await loadDetail();
    if (!detail?.systemSnapshot) return;
    const confirm = form.querySelector('#snapshotConfirm')?.closest('label');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = capabilityFields(detail.systemSnapshot.assessmentConfiguration?.capabilityProfile || {});
    const fields = wrapper.firstElementChild;
    if (confirm) confirm.insertAdjacentElement('beforebegin', fields);
    else form.append(fields);
    form.dataset.capabilityProfileReady = 'true';
  } catch (error) {
    message(`Capability profile could not be loaded: ${error.message}`, true);
  } finally {
    decorating = false;
  }
}

// The existing control page marks any edited form dirty. This capture listener keeps
// capability/remediated-snapshot edits inside this dedicated submit path, which performs
// its own save and reload only after the server confirms the new immutable snapshot.
document.addEventListener('input', (event) => {
  if (event.target.closest?.('#ciControlRoot #snapshotForm')) event.stopPropagation();
}, true);
document.addEventListener('change', (event) => {
  if (event.target.closest?.('#ciControlRoot #snapshotForm')) event.stopPropagation();
}, true);

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'snapshotForm' || !form.closest('#ciControlRoot')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = event.submitter || form.querySelector('button[type="submit"]');
  try {
    if (!form.reportValidity()) return;
    if (button) button.disabled = true;
    const detail = await loadDetail();
    const current = detail?.systemSnapshot;
    if (!current) throw new Error('Current system snapshot is unavailable. Reload before creating the remediated version.');
    const profile = readProfile(form);
    const architectureSummary = document.querySelector('#snapshotArchitecture')?.value || current.architecture?.summary || '';
    const changeExplanation = document.querySelector('#snapshotChange')?.value || '';
    await api(`/api/projects/${encodeURIComponent(projectId)}/control-intelligence`, {
      method: 'POST',
      body: JSON.stringify({
        architecture: { ...current.architecture, summary: architectureSummary, changeExplanation },
        models: current.models,
        tools: current.tools,
        identities: current.identities,
        dataSources: current.dataSources,
        networkAccess: current.networkAccess,
        autonomyLevel: profile.autonomy,
        approvalConfiguration: current.approvalConfiguration,
        assessmentConfiguration: assessmentConfiguration(current, profile),
        source: 'guided_remediation',
        expectedCurrentSnapshotId: current.id,
      }),
    });
    message('Remediated snapshot created with the capability profile bound to the exact new system version. Prior evidence remains historical.');
    location.reload();
  } catch (error) {
    message(error.message, true);
    if (button) button.disabled = false;
  }
}, true);

const observer = new MutationObserver(() => decorate());
observer.observe(document.querySelector('#ciControlRoot') || document.body, { childList: true, subtree: true });
decorate();
