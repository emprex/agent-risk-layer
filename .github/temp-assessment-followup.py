from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


replace(
    'src/risk-engine.js',
    "  const highestSeverity = (items) => items.reduce((highest, item) => severityRank[item.severity] > severityRank[highest] ? item.severity : highest, '');",
    "  const highestSeverity = (items) => items.reduce((highest, item) => (severityRank[item.severity] || 0) > (severityRank[highest] || 0) ? item.severity : highest, '');",
)
replace(
    'src/risk-engine.js',
    "  const highestMaterialSeverity = severityRank[highestFindingSeverity] >= severityRank[highestAttackPathSeverity] ? highestFindingSeverity : highestAttackPathSeverity;",
    "  const highestMaterialSeverity = (severityRank[highestFindingSeverity] || 0) >= (severityRank[highestAttackPathSeverity] || 0) ? highestFindingSeverity : highestAttackPathSeverity;",
)

replace(
    'tests/risk-engine.test.js',
    "test('moderate configuration produces control findings and attack paths', () => {",
    "test('mixed configuration exposes a critical prompt-injection attack path', () => {",
)
replace(
    'tests/risk-engine.test.js',
    "  assert.ok(['Moderate', 'High'].includes(result.riskBand));",
    "  assert.equal(result.riskBand, 'Critical');\n  assert.equal(result.decision, 'DO NOT DEPLOY');\n  assert.ok(result.attackPaths.some((path) => path.severity === 'critical'));",
)

replace(
    'scripts/run-1000-scenarios.mjs',
    """  const orderedBand = result.scoreAvailable === false
    ? result.riskBand === 'Undetermined'
    : result.score >= 75 ? result.riskBand === 'Critical'
      : result.score >= 50 ? result.riskBand === 'High'
        : result.score >= 25 ? result.riskBand === 'Moderate'
          : result.riskBand === 'Low';
""",
    """  const expectedAggregateBand = result.scoreAvailable === false
    ? 'Undetermined'
    : result.score >= 75 ? 'Critical'
      : result.score >= 50 ? 'High'
        : result.score >= 25 ? 'Moderate'
          : 'Low';
  const bandRank = { Undetermined: -1, Low: 0, Moderate: 1, High: 2, Critical: 3 };
  const severityBand = { low: 'Low', medium: 'Moderate', high: 'High', critical: 'Critical' };
  const highestMaterialBand = severityBand[result.highestMaterialSeverity] || 'Undetermined';
  const aggregateBandMatches = result.aggregateRiskBand === expectedAggregateBand;
  const overallBandRespectsFloor = bandRank[result.riskBand] >= Math.max(bandRank[expectedAggregateBand], bandRank[highestMaterialBand]);
""",
)
replace(
    'scripts/run-1000-scenarios.mjs',
    "  const pass = validScore && safeDecision && orderedBand && findingIntegrity && unresolvedIntegrity && unknownIsolation && pathIntegrity && recommendationIntegrity;",
    "  const pass = validScore && safeDecision && aggregateBandMatches && overallBandRespectsFloor && findingIntegrity && unresolvedIntegrity && unknownIsolation && pathIntegrity && recommendationIntegrity;",
)
replace(
    'scripts/run-1000-scenarios.mjs',
    "    checks: { validScore, safeDecision, orderedBand, findingIntegrity, unresolvedIntegrity, unknownIsolation, pathIntegrity, recommendationIntegrity },",
    "    checks: { validScore, safeDecision, aggregateBandMatches, overallBandRespectsFloor, findingIntegrity, unresolvedIntegrity, unknownIsolation, pathIntegrity, recommendationIntegrity },",
)
replace(
    'scripts/run-1000-scenarios.mjs',
    'The packaged assessment engine handled 1,000 reproducible combinations without invalid scores, risk-band inconsistencies, malformed findings, malformed information gaps, unknown answers being scored as vulnerabilities, or a deployment-permitting decision when a critical attack path existed.',
    'The packaged assessment engine handled 1,000 reproducible combinations without invalid scores, aggregate-score band inconsistencies, an overall risk band below the highest declared finding or attack-path severity, malformed findings, malformed information gaps, unknown answers being scored as vulnerabilities, or a deployment-permitting decision when a critical attack path existed.',
)
