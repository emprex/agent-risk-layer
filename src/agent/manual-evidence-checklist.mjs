export function normalizeEvidenceRequirement(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateCanonicalManualEvidenceChecklist({
  manualEvidence,
  workflowState,
  controlId
}) {
  if (manualEvidence.result === 'inconclusive') {
    return {
      observedResult: manualEvidence.observedResult,
      canonicalChecklistVerified: false
    };
  }

  const queueItem =
    (workflowState?.evidenceWorkQueue?.items || [])
      .find((item) => item.controlId === controlId) || null;

  const expected =
    (
      queueItem?.humanOnlyRequirements?.length
        ? queueItem.humanOnlyRequirements
        : queueItem?.requiredEvidence || []
    )
      .map(normalizeEvidenceRequirement)
      .filter(Boolean);

  const machineRequirements =
    (queueItem?.machineCollectableRequirements || [])
      .map(normalizeEvidenceRequirement)
      .filter(Boolean);

  const activeRequirements =
    (queueItem?.activeTestRequirements || [])
      .map(normalizeEvidenceRequirement)
      .filter(Boolean);

  if (
    activeRequirements.length > 0
  ) {
    throw new Error(
      'Conclusive manual evidence is blocked because active or runtime evidence is still required for this control.'
    );
  }

  if (
    machineRequirements.length > 0 &&
    queueItem?.automaticEvidenceCollected !== true
  ) {
    throw new Error(
      'Conclusive manual evidence is blocked because deterministic machine evidence has not yet been collected for this control.'
    );
  }

  if (!expected.length) {
    throw new Error(
      'Conclusive manual evidence is blocked because canonical required evidence is unavailable for this control.'
    );
  }

  const supplied =
    (manualEvidence.evidenceChecklist || [])
      .map((item) => ({
        ...item,
        normalizedRequirement:
          normalizeEvidenceRequirement(item.requirement)
      }));

  const suppliedRequirements =
    supplied.map((item) => item.normalizedRequirement);

  if (
    new Set(suppliedRequirements).size !==
    suppliedRequirements.length
  ) {
    throw new Error(
      'Manual evidence checklist contains duplicate canonical requirements.'
    );
  }

  const expectedSet = new Set(expected);
  const suppliedSet = new Set(suppliedRequirements);

  const missing =
    expected.filter((requirement) =>
      !suppliedSet.has(requirement)
    );

  const unexpected =
    suppliedRequirements.filter((requirement) =>
      !expectedSet.has(requirement)
    );

  if (
    missing.length ||
    unexpected.length ||
    supplied.length !== expected.length
  ) {
    throw new Error(
      'Conclusive manual evidence must address the exact remaining human-only canonical evidence checklist for this control.'
    );
  }

  const checklistProjection =
    expected.map((requirement) => {
      const item =
        supplied.find(
          (candidate) =>
            candidate.normalizedRequirement === requirement
        );

      return {
        requirement,
        evidenceReference: item.evidenceReference,
        observation: item.observation,
        satisfied: item.satisfied
      };
    });

  const observedResult = [
    manualEvidence.observedResult,
    '',
    'Canonical human-only evidence checklist:',
    ...checklistProjection.map(
      (item, index) =>
        `${index + 1}. ${item.requirement} | ${item.evidenceReference} | satisfied=${item.satisfied} | ${item.observation}`
    )
  ].join('\n');

  if (observedResult.length > 6000) {
    throw new Error(
      'Manual evidence checklist is too large for the bounded authoritative observation record.'
    );
  }

  return {
    observedResult,
    canonicalChecklistVerified: true
  };
}
