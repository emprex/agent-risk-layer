import { escapeHtml, qs } from './shared.js';

const TARGET_MARKER = '[ARL_TARGET]';
const assessmentId = qs('id');

function parseTarget(text = '') {
  const value = String(text || '');
  const markerIndex = value.indexOf(TARGET_MARKER);
  if (markerIndex < 0) return null;
  const description = value.slice(0, markerIndex).trim();
  const targetText = value.slice(markerIndex + TARGET_MARKER.length);
  const repository = targetText.match(/Repository:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const revision = targetText.match(/Revision:\s*([a-f0-9]{40})/i)?.[1]?.toLowerCase() || '';
  if (!repository || !revision) return null;
  return { description, repository, revision };
}

function evidenceHref() {
  return assessmentId ? `/inspector.html?assessment=${encodeURIComponent(assessmentId)}` : '';
}

function normalizeEvidenceFirstJourney(root) {
  const inspectorHref = evidenceHref();
  if (!root || !inspectorHref || root.dataset.evidenceFirstNormalized === 'true') return;
  root.dataset.evidenceFirstNormalized = 'true';

  const summary = root.querySelector('.result-decision-card');
  const reasonCells = [...(summary?.querySelectorAll('.result-reason-grid > div') || [])];
  const concernCount = Number(reasonCells[0]?.querySelector('strong')?.textContent || 0);
  const unresolvedCount = Number(reasonCells[1]?.querySelector('strong')?.textContent || 0);

  if (reasonCells[0]?.querySelector('span')) {
    reasonCells[0].querySelector('span').textContent = `declared concern${concernCount === 1 ? '' : 's'}`;
  }
  if (reasonCells[2]?.querySelector('span')) {
    reasonCells[2].querySelector('span').textContent = 'highest declared concern';
  }

  if (summary && unresolvedCount > 0) {
    const heading = summary.querySelector('h2');
    const explanation = heading?.nextElementSibling;
    if (heading) heading.textContent = concernCount
      ? 'Resolve missing information and verify declared concerns before deployment.'
      : 'Resolve the missing information before a deployment review.';
    if (explanation) explanation.textContent = concernCount
      ? `${unresolvedCount} unanswered security question${unresolvedCount === 1 ? '' : 's'} remain and ${concernCount} declared control concern${concernCount === 1 ? '' : 's'} need evidence. Unknowns are not vulnerabilities, and declarations are not confirmed findings.`
      : `${unresolvedCount} unanswered security question${unresolvedCount === 1 ? '' : 's'} remain. Unknowns are information gaps, not vulnerabilities.`;

    const nextAction = summary.querySelector('.result-next-action');
    const nextTitle = nextAction?.querySelector('strong');
    const nextDetail = nextAction?.querySelector('p');
    const nextButton = nextAction?.querySelector('a.button');
    if (nextTitle) nextTitle.textContent = 'Inspect the frozen revision';
    if (nextDetail) nextDetail.textContent = 'Use source evidence to resolve what AgentRiskLayer can observe from this exact commit. Run bounded tests only for questions source review cannot resolve.';
    if (nextButton) {
      nextButton.href = inspectorHref;
      nextButton.textContent = 'Run source evidence';
    }
  }

  const navLinks = [...root.querySelectorAll('.workspace-local-nav a')];
  navLinks.forEach((link) => {
    if (link.getAttribute('href') === '#priorityRisks') link.textContent = 'Declared concerns';
    if (link.getAttribute('href') === '#actionPlan') link.textContent = 'Possible actions';
  });

  const concernSection = root.querySelector('#priorityRisks');
  if (concernSection) {
    const eyebrow = concernSection.querySelector('.workspace-section-heading .eyebrow');
    const heading = concernSection.querySelector('.workspace-section-heading h2');
    const copy = concernSection.querySelector('.workspace-section-heading p');
    if (eyebrow) eyebrow.textContent = 'Declared concerns from answers';
    if (heading && concernCount) heading.textContent = 'Concerns to verify';
    if (copy && concernCount) copy.textContent = 'These items come from questionnaire answers. They are not confirmed findings until observed or test-generated evidence supports them.';

    [...concernSection.querySelectorAll('.finding-id')].forEach((idNode) => {
      idNode.textContent = idNode.textContent.replace(/^F-/, 'C-');
    });
    [...concernSection.querySelectorAll('.plain-finding-sections small')].forEach((label) => {
      if (label.textContent.trim() === 'What we found') label.textContent = 'What was declared';
      if (label.textContent.trim() === 'What to do') label.textContent = 'Possible action if confirmed';
      if (label.textContent.trim() === 'How to prove it is fixed') label.textContent = 'Evidence needed to confirm / retest';
    });
  }

  const actionPlan = root.querySelector('#actionPlan');
  if (actionPlan) {
    const eyebrow = actionPlan.querySelector('.workspace-section-heading .eyebrow');
    const heading = actionPlan.querySelector('.workspace-section-heading h2');
    const copy = actionPlan.querySelector('.workspace-section-heading p');
    const button = actionPlan.querySelector('.workspace-section-heading a.button');
    if (eyebrow) eyebrow.textContent = 'Conditional next steps';
    if (heading) heading.textContent = 'Possible actions if confirmed';
    if (copy) copy.textContent = 'Do not start remediation from questionnaire answers alone. Confirm the concern with source or bounded test evidence first.';
    if (button) {
      button.href = inspectorHref;
      button.textContent = 'Verify with evidence first';
    }
    [...actionPlan.querySelectorAll('.simple-remediation-list article p')].forEach((paragraph) => {
      paragraph.textContent = 'Possible action only. Verify the concern before assigning remediation work.';
    });
  }

  const riskBlock = root.querySelector('.result-side-risk');
  if (riskBlock) {
    const pill = riskBlock.querySelector('.risk-pill');
    const scoreSuffix = riskBlock.querySelector('strong small');
    if (pill && !/incomplete/i.test(pill.textContent)) {
      const band = pill.textContent.replace(/\s+declared band$/i, '').trim();
      pill.textContent = `${band} questionnaire-only band`;
    }
    if (scoreSuffix) scoreSuffix.textContent = '/100 provisional';
    const note = riskBlock.nextElementSibling;
    if (note?.classList.contains('microcopy')) {
      note.textContent = 'Questionnaire-only provisional score. It summarises declared exposure, controls and uncertainty; it is not a verified security rating or probability of breach.';
    }
  }
}

function enhanceTarget() {
  const root = document.querySelector('#resultRoot');
  const sidePanel = root?.querySelector('.result-side-panel');
  if (!sidePanel || sidePanel.dataset.targetEnhanced === 'true') return false;

  const paragraphs = [...sidePanel.querySelectorAll('p')];
  const sourceParagraph = paragraphs.find((node) => node.textContent.includes(TARGET_MARKER));
  if (!sourceParagraph) return false;

  const target = parseTarget(sourceParagraph.textContent);
  if (!target) return false;
  sidePanel.dataset.targetEnhanced = 'true';

  if (target.description) sourceParagraph.textContent = target.description;
  else sourceParagraph.remove();

  const targetCard = document.createElement('section');
  targetCard.className = 'workspace-section result-target-card';
  targetCard.setAttribute('aria-label', 'Frozen assessment target');
  targetCard.innerHTML = `
    <span class="eyebrow">Frozen assessment target</span>
    <h3>${escapeHtml(target.repository)}</h3>
    <p class="microcopy"><strong>Revision</strong><br><code>${escapeHtml(target.revision)}</code></p>
    <p>This assessment is scoped to this exact commit. Evidence from a later revision must not silently replace it.</p>
    ${assessmentId ? `<a class="button primary" href="${evidenceHref()}">Run source evidence</a>` : ''}
    <p class="microcopy">Next: inspect this revision, then run only the bounded checks needed for unresolved evidence questions.</p>`;

  const riskBlock = sidePanel.querySelector('.result-side-risk');
  sidePanel.insertBefore(targetCard, riskBlock || null);

  const header = root.querySelector('.result-agent-header > div:first-child');
  if (header && !header.querySelector('[data-frozen-target]')) {
    const badge = document.createElement('p');
    badge.dataset.frozenTarget = 'true';
    badge.className = 'microcopy';
    badge.innerHTML = `Frozen source · ${escapeHtml(target.repository)} @ <code>${escapeHtml(target.revision.slice(0, 12))}</code>`;
    header.appendChild(badge);
  }

  normalizeEvidenceFirstJourney(root);
  return true;
}

const observer = new MutationObserver(() => {
  if (enhanceTarget()) observer.disconnect();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceTarget();
