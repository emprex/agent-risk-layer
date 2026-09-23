export function getInspectionEvidence(inspection, ruleId) {
  if (!inspection) {
    throw new Error('inspection is required');
  }

  if (!ruleId) {
    throw new Error('ruleId is required');
  }

  const findings = Array.isArray(inspection.findings)
    ? inspection.findings
    : [];

  const matches = findings.filter((finding) => finding.ruleId === ruleId);

  if (matches.length === 0) {
    return {
      found: false,
      ruleId,
      findings: [],
    };
  }

  return {
    found: true,
    ruleId,
    count: matches.length,
    findings: matches.map((finding) => ({
      ruleId: finding.ruleId,
      title: finding.title ?? null,
      severity: finding.severity ?? null,
      confidence: finding.confidence ?? null,
      category: finding.category ?? null,
      summary: finding.summary ?? null,
      remediation: finding.remediation ?? null,
      frameworks: Array.isArray(finding.frameworks)
        ? finding.frameworks
        : [],
      evidence: Array.isArray(finding.evidence)
        ? finding.evidence
        : [],
      review: finding.review ?? null,
    })),
  };
}
