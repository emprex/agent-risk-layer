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
    (queueItem?.requiredEvidence || [])
      .map(normalizeEvidenceRequirement)
      .filter(Boolean);

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
      'Conclusive manual evidence must address the exact canonical required-evidence checklist for this control.'
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
    'Canonical required-evidence checklist:',
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
