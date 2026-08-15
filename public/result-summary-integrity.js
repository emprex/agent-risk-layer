/*
 * Free assessment responses intentionally expose only the customer-visible finding set.
 * Older/free projections may omit highestFindingSeverity even when those rendered findings
 * already carry severity. Keep the summary internally consistent by deriving only from the
 * findings that are actually visible to the customer. Never invent a severity when no
 * rendered finding supports it, and never overwrite an explicit severity from the server.
 */

const root = document.querySelector('#resultRoot');
const severityRank = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

function severityFromText(value) {
  const text = String(value || '').trim().toLowerCase();
  return Object.hasOwn(severityRank, text) ? text : '';
}

function severityLabel(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : '';
}

function highestVisibleFindingSeverity() {
  if (!root) return '';
  return [...root.querySelectorAll('#priorityRisks .finding-work-item > summary .evidence-chip')]
    .map((node) => severityFromText(node.textContent))
    .filter(Boolean)
    .reduce((highest, current) => severityRank[current] > (severityRank[highest] || 0) ? current : highest, '');
}

function metricValueByLabel(container, labelPattern) {
  if (!container) return null;
  for (const item of container.children) {
    const label = item.querySelector('span');
    const value = item.querySelector('strong');
    if (label && value && labelPattern.test(label.textContent || '')) return value;
  }
  return null;
}

function correctMissingHighestSeverity() {
  if (!root || !root.querySelector('.result-workspace')) return false;

  const findingCountText = root.querySelector('.result-reason-grid > div:first-child strong')?.textContent || '0';
  const findingCount = Number.parseInt(findingCountText, 10) || 0;
  if (!findingCount) return true;

  const highest = highestVisibleFindingSeverity();
  if (!highest) return false;
  const label = severityLabel(highest);

  const summaryValue = metricValueByLabel(root.querySelector('.result-reason-grid'), /highest declared finding/i);
  if (summaryValue && /^(?:none|—|-)?$/i.test(summaryValue.textContent.trim())) summaryValue.textContent = label;

  const technicalGrid = root.querySelector('#evidenceDetails .metric-grid');
  const technicalValue = metricValueByLabel(technicalGrid, /highest declared finding/i);
  if (technicalValue && /^(?:none|—|-)?$/i.test(technicalValue.textContent.trim())) technicalValue.textContent = label;

  return true;
}

if (root) {
  const observer = new MutationObserver(() => {
    if (correctMissingHighestSeverity()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  correctMissingHighestSeverity();
}
