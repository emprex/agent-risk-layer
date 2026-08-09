import test from 'node:test';
import assert from 'node:assert/strict';
import {
  benchmarkRelevantRuleIds,
  externalSignalLabels,
  mappedSignalsForRow,
  summariseClawHubBenchmark,
} from '../src/clawhub-inspector-benchmark.js';

test('benchmark excludes generic repository hygiene findings', () => {
  assert.deepEqual(benchmarkRelevantRuleIds([
    { ruleId: 'ARL-REPO-001' },
    { ruleId: 'ARL-REPO-002' },
    { ruleId: 'ARL-MCP-001' },
    { ruleId: 'ARL-MCP-001' },
  ]), ['ARL-MCP-001']);
});

test('external comparison never requires VirusTotal fields', () => {
  const row = {
    clawscan_verdict: 'suspicious',
    static_status: 'clean',
    skillspector_status: 'suspicious',
    virustotal_status: 'malicious',
    static_reason_codes: ['suspicious.dynamic_code_execution'],
    skillspector_issue_categories: ['Dangerous Code Execution'],
  };
  assert.deepEqual(externalSignalLabels(row), { clawscan: true, static: false, skillspector: true });
  assert.deepEqual(mappedSignalsForRow(row), [
    'skillspector:Dangerous Code Execution',
    'static:suspicious.dynamic_code_execution',
  ]);
});

test('summary reports concordance rather than accuracy', () => {
  const report = summariseClawHubBenchmark([
    {
      external: { clawscan: true, static: true, skillspector: false },
      mappedSignals: ['static:suspicious.dynamic_code_execution'],
      arlRuleIds: ['ARL-AI-001'],
      arlPositive: true,
    },
    {
      external: { clawscan: false, static: false, skillspector: true },
      mappedSignals: [],
      arlRuleIds: [],
      arlPositive: false,
    },
  ], { split: 'test', sourceRevision: 'example' });

  assert.equal(report.rowsEvaluated, 2);
  assert.equal(report.externalComparison.static.bothPositive, 1);
  assert.equal(report.externalComparison.skillspector.externalOnly, 1);
  assert.equal(report.mappedSignalConcordance['static:suspicious.dynamic_code_execution'].concordance, 1);
  assert.equal('accuracy' in report, false);
  assert.match(report.limitations.join(' '), /not comparative product accuracy/i);
});
