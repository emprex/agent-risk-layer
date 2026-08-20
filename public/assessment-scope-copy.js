const root = document.querySelector('#controlPlaneRoot');

function syncAssessmentScopeCopy() {
  const params = new URLSearchParams(location.search);
  if (!params.get('assessment') || !root) return;

  const workspace = root.querySelector('.assessment-remediation-workspace');
  const canonicalName = workspace?.querySelector('.assessment-scope-banner h2')?.textContent?.trim();
  if (!canonicalName) return;

  const heading = workspace.querySelector('.assessment-only-remediation .section-heading');
  const scopeCopy = heading?.querySelector('p');
  if (!scopeCopy) return;

  scopeCopy.textContent = `Each fix is bound to this assessment and the selected ${canonicalName} scope.`;
}

syncAssessmentScopeCopy();

if (root) {
  new MutationObserver(syncAssessmentScopeCopy).observe(root, { childList: true, subtree: true });
}
