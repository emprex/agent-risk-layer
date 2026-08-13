from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    'src/control-redteam-evidence.js',
    "    if (time(retestRun.created_at) <= time(baselineRun.created_at)) throw error('The retest run must be newer than the failed baseline run.');\n",
    "    const baselineCampaignForChronology = parse(baselineRun.campaign_json, {});\n"
    "    const retestCampaignForChronology = parse(retestRun.campaign_json, {});\n"
    "    const baselineCompletedAt = time(baselineCampaignForChronology.completedAt);\n"
    "    const retestCompletedAt = time(retestCampaignForChronology.completedAt);\n"
    "    if (baselineCompletedAt == null || retestCompletedAt == null) {\n"
    "      throw error('Baseline and retest runs must contain valid signed campaign completion timestamps.');\n"
    "    }\n"
    "    if (retestCompletedAt <= baselineCompletedAt) throw error('The retest campaign must have completed after the failed baseline campaign.');\n",
)

marker = "test('Red Team binding rejects a different request fingerprint instead of treating a non-comparable pass as closure evidence', async () => {\n"
regression = """test('Red Team binding orders recovered evidence by signed campaign completion time, not database ingestion time', async () => {
  const f = await fixture('redteam-recovered-chronology');
  const chain = await lineage(f);
  const runs = await redTeamPair(f);

  const futureBaselineIngestion = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare('UPDATE redteam_runs SET created_at=? WHERE id=?').run(futureBaselineIngestion, runs.baselineId);
  const rows = await db.prepare('SELECT id,created_at,campaign_json FROM redteam_runs WHERE id IN (?,?)').all(runs.baselineId, runs.retestId);
  const baseline = rows.find((row) => row.id === runs.baselineId);
  const retest = rows.find((row) => row.id === runs.retestId);
  assert.ok(Date.parse(retest.created_at) < Date.parse(baseline.created_at), 'database ingestion order is intentionally reversed');
  assert.ok(Date.parse(JSON.parse(retest.campaign_json).completedAt) > Date.parse(JSON.parse(baseline.campaign_json).completedAt), 'signed execution chronology remains baseline then retest');

  const evidence = await bind(f, chain, runs);
  assert.equal(evidence.verificationState, 'verified');
  assert.equal(evidence.redteamRunId, runs.retestId);
  assert.equal(evidence.redteamBaselineRunId, runs.baselineId);
  assert.equal(evidence.observedAt, runs.retestCreated);
});

"""
replace_once('tests/control-intelligence-redteam-binding.test.js', marker, regression + marker)
