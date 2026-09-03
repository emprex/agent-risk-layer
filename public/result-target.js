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
    ${assessmentId ? `<a class="button primary" href="/inspector.html?assessment=${encodeURIComponent(assessmentId)}">Run source evidence</a>` : ''}
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
  return true;
}

const observer = new MutationObserver(() => {
  if (enhanceTarget()) observer.disconnect();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceTarget();
