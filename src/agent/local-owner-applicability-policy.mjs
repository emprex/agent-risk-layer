function labelsFromDetail(detail) {
  const problemLabels =
    detail?.control?.problem?.applicability;

  if (Array.isArray(problemLabels)) {
    return problemLabels
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
  }

  const projected =
    detail?.applicabilityScope;

  return Array.isArray(projected)
    ? projected
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    : [];
}

export function deriveLocalOwnerApplicability(detail) {
  if (detail?.chain?.currentStage !== 'applicability') {
    return null;
  }

  const labels = labelsFromDetail(detail);

  /*
   * This is deliberately narrow. "all agents" is an unconditional canonical
   * scope, so asking the local repository owner whether it applies adds no
   * security information. Other scopes still require facts or human review.
   */
  if (labels.includes('all agents')) {
    return {
      decision: 'applicable',
      architectureFactIds: [],
      reason:
        'Owner-authorised local assessment policy: this canonical control applies to all agents, so applicability is unconditional for the exact assessed target. This records scope only; it does not prove the control passes or approve deployment.'
    };
  }

  return null;
}
