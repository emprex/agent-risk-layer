/*
 * Keep the customer-visible result summary internally consistent without changing
 * assessment semantics. Unknown answers remain information gaps; this module only
 * repairs presentation/next-action priority when a known material finding exists.
 *
 * Free assessment responses intentionally expose only the customer-visible finding set.
 * Older/free projections may omit highestFindingSeverity even when those rendered findings
 * already carry severity. Derive only from findings actually rendered to the customer.
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

function visibleFindingRows() {
  if (!root) return [];
  return [...root.querySelectorAll('#priorityRisks .finding-work-item')];
}

function highestVisibleFindingSeverity() {
  return visibleFindingRows()
    .map((row) => severityFromText(row.querySelector(':scope > summary .severity')?.textContent))
    .filter(Boolean)
    .reduce((highest, current) => severityRank[current] > (severityRank[highest] || 0) ? current : highest, '');
}

function priorityMaterialFinding() {
  return visibleFindingRows().find((row) => {
    const severity = severityFromText(row.querySelector(':scope > summary .severity')?.textContent);
    return severity === 'critical' || severity === 'high';
  }) || null;
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

function resultHasRendered() {
  if (!root) return false;
  return root.classList.contains('result-workspace') && Boolean(root.querySelector('.result-reason-grid'));
}

function correctMissingHighestSeverity() {
  if (!resultHasRendered()) return false;

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

function prioritizeMaterialFinding() {
  if (!resultHasRendered()) return false;

  const informationSection = root.querySelector('#informationNeeded');
  const finding = priorityMaterialFinding();
  if (!informationSection || !finding) return true;

  const prioritySection = root.querySelector('#priorityRisks');
  if (prioritySection && informationSection.parentElement === prioritySection.parentElement) {
    informationSection.parentElement.insertBefore(prioritySection, informationSection);
  }

  const action = root.querySelector('.result-next-action');
  const actionTitle = action?.querySelector('strong');
  const actionDetail = action?.querySelector('p');
  const actionLink = action?.querySelector('a');
  const findingTitle = finding.querySelector(':scope > summary strong')?.textContent?.trim() || 'Address the highest-priority security finding';
  const paidRemediationLink = root.querySelector('#actionPlan a[href]');

  if (actionTitle) actionTitle.textContent = findingTitle;
  if (actionDetail) {
    actionDetail.textContent = 'Address this declared material weakness first. Information gaps remain separate and should still be confirmed, but they do not outrank a known deployment blocker.';
  }
  if (actionLink) {
    if (paidRemediationLink) {
      actionLink.href = paidRemediationLink.href;
      actionLink.textContent = 'Start remediation';
    } else {
      actionLink.href = '#priorityRisks';
      actionLink.textContent = 'Open highest-priority finding';
    }
  }

  return true;
}

function reconcileResultSummary() {
  const severityReady = correctMissingHighestSeverity();
  const priorityReady = prioritizeMaterialFinding();
  return severityReady && priorityReady;
}

if (root) {
  const observer = new MutationObserver(() => {
    if (reconcileResultSummary()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  reconcileResultSummary();
}
