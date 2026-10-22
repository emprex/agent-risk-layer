import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildCustomerAssessmentDeliverable,
  writeCustomerAssessmentDeliverable
} from '../src/agent/customer-assessment-deliverable.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'a'.repeat(40);
const syntheticReport = {
  schema: 'arl.customer-assessment-report.v1',
  available: true,
  projection: 'read_only',
  assessment: {
    projectName: 'Synthetic desktop reporter',
    targetRevision: revision,
    systemSnapshotVersion: 'synthetic-python-gui-report-v1',
    controlProfileVersion: 'ARL-RKA-1.2.0',
    mappedControlCount: 0
  },
  controls: [],
  readiness: {
    status: 'HOLD',
    rationale: 'Synthetic review, not a customer decision.',
    humanReviewRequired: true,
    finalDecisionAuthority: 'human',
    finalDecisionRecorded: false,
    conversationLayerDecisionWritten: false
  },
  securityStateChanged: false,
  deploymentDecisionWritten: false,
  humanReviewRequired: true,
  disclaimer: 'SYNTHETIC ONLY — not a real ARL audit'
};

test('Python desktop uses canonical ARL report verification and rejects tampering', t => {
  const canRun = spawnSync('python3', ['--version'], {encoding:'utf8',timeout:3000});
  if (canRun.error?.code === 'ENOENT') {
    t.skip('Python 3 not installed in runner');
    return;
  }
  assert.equal(canRun.status, 0, canRun.stderr);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-python-report-'));
  try {
    const deliverable = buildCustomerAssessmentDeliverable(
      structuredClone(syntheticReport)
    );
    const written = writeCustomerAssessmentDeliverable({
      deliverable, outputDirectory
    });
    const manifest = written.files.find(x => x.name.endsWith('.manifest.json')).path;
    const markdown = written.files.find(x => x.name.endsWith('.md')).path;

    const verify = () => spawnSync('python3', [
      'desktop/arl_operator.py', '--verify-report', manifest
    ], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://SYNTHETIC_DB_SECRET@127.0.0.1/nowhere',
        NODE_OPTIONS: '--require=nonexistent-unsafe-module',
        PYTHONDONTWRITEBYTECODE: '1',
        DISPLAY: ''
      },
      encoding: 'utf8',
      timeout: 20_000
    });

    const accepted = verify();
    assert.equal(accepted.status, 0, accepted.stderr);
    const details = JSON.parse(accepted.stdout);
    assert.equal(details.available, true);
    assert.equal(details.integrity, 'consistent_only');
    assert.equal(details.security_verdict, 'not_assessed');
    assert.equal(details.authenticity, 'not_verified_no_signature');
    assert.equal(details.human_review_required, true);
    assert.equal(details.reported_readiness_label, 'HOLD');
    assert.equal(details.contents_displayed, false);
    assert.doesNotMatch(accepted.stdout + accepted.stderr,
      /SYNTHETIC_DB_SECRET|Synthetic review, not a customer decision/);

    fs.appendFileSync(markdown, '\nSYNTHETIC_TAMPER\n');
    const rejected = verify();
    assert.equal(rejected.status, 1, rejected.stderr);
    const failure = JSON.parse(rejected.stdout);
    assert.equal(failure.available, false);
    assert.equal(failure.integrity, 'not_established');
    assert.doesNotMatch(rejected.stdout + rejected.stderr,
      /SYNTHETIC_DB_SECRET|SYNTHETIC_TAMPER/);
  } finally {
    fs.rmSync(outputDirectory, {recursive:true,force:true});
  }
});
