import { api } from './shared.js';

const path = location.pathname.split('/').pop() || 'index.html';
const workspacePages = new Set(['dashboard.html', 'result.html', 'control-intelligence.html', 'assessment.html']);
let enhancementScheduled = false;
if (!workspacePages.has(path)) {
  // This asset is intentionally scoped to the controlled commercial workspace surfaces.
} else {
  rewriteWorkspaceNavigation();
  enhanceStaticCopy();
  startSurfaceEnhancement();
}

function rewriteWorkspaceNavigation() {
  const nav = document.querySelector('#primaryNavigation');
  if (!nav || nav.dataset.workspaceNav === 'true') return;
  const logout = nav.querySelector('#logout');
  nav.querySelectorAll('a').forEach((link) => link.remove());
  const links = [
    ['/dashboard.html', 'Overview', path === 'dashboard.html' && !location.hash],
    ['/assessment.html', 'Assess', path === 'assessment.html'],
    ['/control-plane.html#remediation', 'Fixes', false],
    ['/inspector.html', 'Evidence', false],
    ['/control-plane.html', 'Runtime', false],
    ['/dashboard.html#settings', 'Settings', path === 'dashboard.html' && location.hash === '#settings'],
  ];
  for (const [href, label, active] of links) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = label;
    if (active) anchor.classList.add('active');
    nav.insertBefore(anchor, logout || null);
  }
  nav.dataset.workspaceNav = 'true';
}

function enhanceStaticCopy() {
  if (path === 'dashboard.html') {
    const heading = document.querySelector('.app-page-heading > div');
    const eyebrow = heading?.querySelector('.eyebrow');
    const copy = heading?.querySelector('p');
    if (eyebrow) eyebrow.textContent = 'Security workspace';
    if (copy) copy.textContent = 'Start with the one action that moves this agent toward a defensible deployment decision. Evidence and technical tools stay available when you need them.';
  }

  if (path === 'control-intelligence.html') {
    const heading = document.querySelector('.page-heading > div');
    const eyebrow = heading?.querySelector('.eyebrow');
    const h1 = heading?.querySelector('h1');
    const copy = heading?.querySelector('p');
    if (eyebrow) eyebrow.textContent = 'Control Intelligence';
    if (h1) h1.textContent = 'Deployment evidence';
    if (copy) copy.textContent = 'See whether the current system has enough evidence to support deployment, what is missing and what to do next.';
    const crumb = document.querySelector('.breadcrumbs span:last-child');
    if (crumb) crumb.textContent = 'Deployment evidence';
    const tabLabels = { overview: 'Summary', controls: 'Controls', chain: 'Evidence', decision: 'Decision' };
    document.querySelectorAll('.ci-tabs [data-view]').forEach((button) => {
      const label = tabLabels[button.dataset.view];
      if (label) button.textContent = label;
    });
  }

  if (path === 'assessment.html') {
    const intro = document.querySelector('.assessment-intro');
    const eyebrow = intro?.querySelector('.eyebrow');
    const h1 = intro?.querySelector('h1');
    const copy = intro?.querySelector(':scope > p');
    if (eyebrow) eyebrow.textContent = 'Assess one agent';
    if (h1) h1.textContent = 'Check one AI agent.';
    if (copy) copy.textContent = 'Answer one question at a time about the current system. Unknown information stays an information gap; it is not turned into a vulnerability.';
    const meta = document.querySelector('#profileStep .question-meta span:last-child');
    if (meta) meta.textContent = 'Start';
  }
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    if (path === 'dashboard.html') enhanceDashboard();
    else if (path === 'result.html') enhanceResult();
    else if (path === 'control-intelligence.html') enhanceControlIntelligence();
    else if (path === 'assessment.html') enhanceAssessment();
  });
}

function startSurfaceEnhancement() {
  scheduleEnhancement();
  const target = path === 'dashboard.html'
    ? document.querySelector('#dashboardRoot')
    : path === 'result.html'
      ? document.querySelector('#resultRoot')
      : path === 'control-intelligence.html'
        ? document.querySelector('#ciRoot')
        : document.querySelector('#assessmentForm');
  if (!target) return;
  new MutationObserver(scheduleEnhancement).observe(target, { childList: true, subtree: true, characterData: true });
  if (path === 'control-intelligence.html') {
    document.querySelector('#ciProject')?.addEventListener('change', () => {
      delete document.querySelector('#ciRoot')?.dataset.workspaceDecisionProject;
      scheduleEnhancement();
    });
  }
}

function wrapInDetails(node, title, note, className = '') {
  if (!node || node.closest('.workspace-secondary-details')) return null;
  const details = document.createElement('details');
  details.className = `workspace-secondary-details ${className}`.trim();
  const summary = document.createElement('summary');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = note;
  summary.append(strong, small);
  node.insertAdjacentElement('beforebegin', details);
  details.append(summary, node);
  return details;
}

function enhanceDashboard() {
  const root = document.querySelector('#dashboardRoot');
  if (!root || root.classList.contains('loading')) return;

  const next = root.querySelector('.v10-dashboard-next');
  const secondary = next?.querySelector('.dashboard-secondary-actions');
  if (secondary && !secondary.closest('.workspace-secondary-details')) {
    wrapInDetails(secondary, 'Other tasks', 'Assessment, review and runtime shortcuts', 'workspace-other-tasks');
  }

  const progress = root.querySelector('.v10-progress-panel');
  if (progress && !progress.closest('.workspace-progress-wrap')) {
    const details = wrapInDetails(progress, 'Security progress', 'Supporting status — not a deployment approval', 'workspace-progress-wrap');
    if (details) details.open = false;
  }

  groupAssessmentHistory(root);
}

function assessmentGroupKey(row) {
  const name = row.querySelector('h3')?.textContent.trim() || '';
  const meta = row.querySelector('.assessment-main > p')?.textContent.trim() || '';
  const type = meta.split('· checked')[0].trim();
  return `${name}::${type}`;
}

function groupAssessmentHistory(root) {
  const list = root.querySelector('.assessment-list');
  if (!list || list.dataset.workspaceGrouped === 'true') return;
  const rows = [...list.children].filter((node) => node.classList?.contains('customer-assessment-row'));
  if (!rows.length) return;
  const groups = new Map();
  for (const row of rows) {
    const key = assessmentGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  if (![...groups.values()].some((items) => items.length > 1)) {
    list.dataset.workspaceGrouped = 'true';
    return;
  }

  for (const items of groups.values()) {
    const group = document.createElement('div');
    group.className = 'workspace-assessment-group';
    items[0].insertAdjacentElement('beforebegin', group);
    group.append(items[0]);
    if (items.length > 1) {
      const history = document.createElement('details');
      history.className = 'workspace-history';
      const summary = document.createElement('summary');
      summary.textContent = `Previous assessments (${items.length - 1})`;
      history.append(summary);
      items.slice(1).forEach((row) => history.append(row));
      group.append(history);
    }
  }
  list.dataset.workspaceGrouped = 'true';
}

function enhanceResult() {
  const root = document.querySelector('#resultRoot');
  if (!root || root.classList.contains('loading') || !root.querySelector('.decision-first-card')) return;

  const decisionCard = root.querySelector('.decision-first-card');
  if (!decisionCard.querySelector('.workspace-result-summary')) {
    const findings = root.querySelectorAll('#priorityRisks .plain-finding-list > .plain-finding-card').length;
    const gaps = root.querySelectorAll('#informationNeeded .plain-finding-list > .plain-finding-card').length;
    const label = root.querySelector('.decision-state small')?.textContent.trim() || 'Review required';
    const summary = document.createElement('div');
    summary.className = 'workspace-result-summary';
    summary.innerHTML = `<div><strong>${findings}</strong><span>declared finding${findings === 1 ? '' : 's'}</span></div><div><strong>${gaps}</strong><span>information gap${gaps === 1 ? '' : 's'}</span></div><div><strong>${escapeMarkup(label)}</strong><span>current assessment posture</span></div>`;
    decisionCard.querySelector('.decision-state')?.insertAdjacentElement('afterend', summary);
  }

  const primary = decisionCard.querySelector('.decision-actions .button.primary');
  const findingCount = root.querySelectorAll('#priorityRisks .plain-finding-card').length;
  const gapCount = root.querySelectorAll('#informationNeeded .plain-finding-card').length;
  if (primary && primary.dataset.workspaceCopy !== 'true') {
    primary.textContent = gapCount && !findingCount ? 'Complete missing information' : findingCount ? 'Start with the first finding' : 'Review the assessment';
    primary.dataset.workspaceCopy = 'true';
  }

  const buyButton = root.querySelector('#buyPro');
  if (buyButton && !root.querySelector('.workspace-upgrade-card')) {
    const card = document.createElement('section');
    card.className = 'workspace-upgrade-card';
    card.innerHTML = `<div><span class="eyebrow">Complete assessment package</span><h2>Turn this check into an evidence-backed £99 assessment.</h2><p>Unlock the full report, remediation and retest workflow without claiming evidence that has not actually been collected.</p></div><button class="button primary" type="button">Review the £99 assessment</button>`;
    card.querySelector('button').addEventListener('click', () => buyButton.click());
    decisionCard.insertAdjacentElement('afterend', card);
  }

  compactFindingSection(root.querySelector('#informationNeeded'), 3);
  compactFindingSection(root.querySelector('#priorityRisks'), 3);
}

function compactFindingSection(section, visibleCount) {
  const list = section?.querySelector('.plain-finding-list');
  if (!list || list.dataset.workspaceCompact === 'true') return;
  const cards = [...list.children].filter((node) => node.classList?.contains('plain-finding-card'));
  cards.forEach((card, index) => addFindingToggle(card, index !== 0));
  if (cards.length > visibleCount) {
    const details = document.createElement('details');
    details.className = 'workspace-more-findings';
    const summary = document.createElement('summary');
    summary.textContent = `View ${cards.length - visibleCount} additional item${cards.length - visibleCount === 1 ? '' : 's'}`;
    details.append(summary);
    cards.slice(visibleCount).forEach((card) => details.append(card));
    list.append(details);
  }
  list.dataset.workspaceCompact = 'true';
}

function addFindingToggle(card, collapsed) {
  if (card.querySelector('.workspace-finding-toggle')) return;
  if (collapsed) card.classList.add('workspace-collapsed');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workspace-finding-toggle';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.textContent = collapsed ? 'View fix and proof' : 'Hide detail';
  button.addEventListener('click', () => {
    const isCollapsed = card.classList.toggle('workspace-collapsed');
    button.setAttribute('aria-expanded', String(!isCollapsed));
    button.textContent = isCollapsed ? 'View fix and proof' : 'Hide detail';
  });
  card.querySelector('.plain-finding-heading')?.insertAdjacentElement('afterend', button);
}

let ciRequestSerial = 0;
async function enhanceControlIntelligence() {
  const root = document.querySelector('#ciRoot');
  if (!root || root.classList.contains('loading')) return;
  const view = new URLSearchParams(location.search).get('view') || 'overview';
  if (view !== 'overview') return;
  root.classList.add('workspace-ci-overview');

  wrapCiSupportingDetails(root);
  const project = document.querySelector('#ciProject')?.value || new URLSearchParams(location.search).get('projectId') || '';
  if (!project || root.querySelector('.workspace-ci-decision')?.dataset.project === project) return;
  const serial = ++ciRequestSerial;
  try {
    const payload = await api(`/api/projects/${encodeURIComponent(project)}/control-intelligence?limit=8`);
    if (serial !== ciRequestSerial) return;
    const liveProject = document.querySelector('#ciProject')?.value || project;
    if (liveProject !== project) return;
    renderCiDecision(root, project, payload);
  } catch {
    // The underlying page already owns error reporting. The UX layer must never mask it.
  }
}

function wrapCiSupportingDetails(root) {
  const metrics = root.querySelector(':scope > .ci-metrics');
  if (metrics && !metrics.closest('.workspace-ci-support')) {
    wrapInDetails(metrics, 'Supporting counts', 'Controls, evidence, findings, retests and approvals', 'workspace-ci-support');
  }
  const systemPanel = [...root.querySelectorAll(':scope > .panel')].find((panel) => panel.querySelector(':scope > h2')?.textContent.trim() === 'Assessed system');
  if (systemPanel && !systemPanel.closest('.workspace-ci-technical')) {
    const details = wrapInDetails(systemPanel, 'Technical provenance', 'System version, digest and capability profile', 'workspace-ci-technical');
    const next = details?.nextElementSibling;
    if (details && next?.tagName === 'DETAILS' && next.classList.contains('panel')) details.append(next);
  }
}

function renderCiDecision(root, project, payload) {
  root.querySelector('.workspace-ci-decision')?.remove();
  const summary = payload?.summary || {};
  const deployment = payload?.deploymentState || null;
  const rawDecision = deployment?.decision ? String(deployment.decision) : '';
  const normalized = rawDecision.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  const state = normalized.includes('do-not-deploy') ? 'do-not-deploy' : normalized.includes('proceed') ? 'proceed' : rawDecision ? 'hold' : 'unresolved';
  const title = rawDecision ? humanize(rawDecision) : 'Decision not recorded yet';
  const rationale = deployment?.rationale || 'Complete the relevant control, evidence and retest stages before relying on a deployment decision.';
  const reasons = [
    [summary.controlsMissingEvidence, 'missing evidence'],
    [summary.findingsAwaitingRemediation, 'open findings'],
    [summary.retestsRequired, 'retests required'],
    [summary.approvalsRequired, 'approvals required'],
    [summary.deploymentBlockers, 'deployment blockers'],
    [summary.candidatesNeedingReview, 'controls to review'],
  ].filter(([value]) => value !== null && value !== undefined && Number(value) > 0).slice(0, 4);
  if (!reasons.length) reasons.push([summary.deploymentBlockers ?? 0, 'known deployment blockers']);

  const next = summary.nextAction || {};
  const nextText = next.nextAction || 'Review the current control evidence and deployment decision.';
  const nextDetail = next.controlTitle || 'Keep evidence tied to the exact current system version.';
  const nextHref = next.controlId
    ? `/control-intelligence-control.html?projectId=${encodeURIComponent(project)}&controlId=${encodeURIComponent(next.controlId)}`
    : `/control-intelligence.html?projectId=${encodeURIComponent(project)}&view=decision`;

  const card = document.createElement('section');
  card.className = 'workspace-ci-decision';
  card.dataset.project = project;
  card.dataset.state = state;
  card.innerHTML = `<span class="eyebrow">Current deployment posture</span><h2>${escapeMarkup(title)}</h2><p>${escapeMarkup(rationale)}</p><div class="workspace-ci-reasons">${reasons.map(([value, label]) => `<div><strong>${Number(value) || 0}</strong><span>${escapeMarkup(label)}</span></div>`).join('')}</div><div class="workspace-ci-next"><div><strong>Next action</strong><p>${escapeMarkup(nextText)}${nextDetail ? ` · ${escapeMarkup(nextDetail)}` : ''}</p></div><a class="button primary" href="${nextHref}">Continue →</a></div>`;
  root.insertAdjacentElement('afterbegin', card);
}

function enhanceAssessment() {
  const form = document.querySelector('#assessmentForm');
  if (!form) return;
  let tracker = form.querySelector('.workspace-assessment-tracker');
  if (!tracker) {
    tracker = document.createElement('div');
    tracker.className = 'workspace-assessment-tracker';
    tracker.innerHTML = `<div class="workspace-assessment-section-label"><strong>Section 1 of 5 · Agent & access</strong><span>One question at a time</span></div><div class="workspace-assessment-sections" aria-hidden="true">${Array.from({ length: 5 }, () => '<span></span>').join('')}</div>`;
    form.querySelector('.assessment-progress')?.insertAdjacentElement('beforebegin', tracker);
  }

  const profileVisible = !document.querySelector('#profileStep')?.hidden;
  let current = 1;
  let total = 1;
  const stepNode = document.querySelector('#stepCount');
  if (!profileVisible) {
    const stepText = stepNode?.textContent || '';
    const match = stepText.match(/(\d+)\s+of\s+(\d+)/i);
    if (match) {
      current = Number(match[1]);
      total = Number(match[2]);
      if (stepNode) {
        stepNode.dataset.workspaceCurrent = String(current);
        stepNode.dataset.workspaceTotal = String(total);
      }
    } else {
      current = Number(stepNode?.dataset.workspaceCurrent || 2);
      total = Number(stepNode?.dataset.workspaceTotal || 2);
    }
  }
  const section = profileVisible ? 1 : Math.min(5, Math.max(1, Math.ceil((current / Math.max(total, 1)) * 5)));
  const labels = ['Agent & access', 'Data & inputs', 'Actions & authority', 'Controls & approval', 'Recovery & evidence'];
  const label = tracker.querySelector('.workspace-assessment-section-label strong');
  const suffix = tracker.querySelector('.workspace-assessment-section-label span');
  const desired = `Section ${section} of 5 · ${labels[section - 1]}`;
  if (label && label.textContent !== desired) label.textContent = desired;
  if (suffix) suffix.textContent = profileVisible ? 'Start with the system you are checking' : 'One question at a time';
  tracker.querySelectorAll('.workspace-assessment-sections span').forEach((node, index) => {
    node.classList.toggle('complete', index + 1 < section);
    node.classList.toggle('active', index + 1 === section);
  });

  if (stepNode && !profileVisible) {
    const questionNumber = Math.max(1, current - 1);
    const value = `Question ${questionNumber}`;
    if (stepNode.textContent !== value) stepNode.textContent = value;
  }
  const profileMeta = document.querySelector('#profileStep .question-meta span:last-child');
  if (profileMeta && profileMeta.textContent !== 'Start') profileMeta.textContent = 'Start';
}

function humanize(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
