#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPhase6Recovery } from './phase6-recovery.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'evidence', 'generated');
fs.mkdirSync(outputDir, { recursive: true });

const run = runPhase6Recovery();
const paths = {
  recoveryEvidence: path.join(outputDir, 'phase6-recovery-evidence.jsonl'),
  recoveryRecord: path.join(outputDir, 'phase6-recovery-record.json'),
  reviewPacket: path.join(outputDir, 'phase6-deployment-review-packet.json'),
};

run.recorder.writeJsonl(paths.recoveryEvidence);
fs.writeFileSync(paths.recoveryRecord, run.recoveryRecordBody, 'utf8');
fs.writeFileSync(paths.reviewPacket, `${JSON.stringify(run.reviewPacket, null, 2)}\n`, 'utf8');

console.log(`ARL17K Phase 6 recovery evidence: ${paths.recoveryEvidence}`);
console.log(`ARL17K Phase 6 recovery record: ${paths.recoveryRecord}`);
console.log(`ARL17K Phase 6 deployment review packet: ${paths.reviewPacket}`);
console.log(`Starting unsafe release state: ${run.phase5.baseline.lab.releaseState}`);
console.log(`Agent stopped: ${run.state.agent_stopped}`);
console.log(`Synthetic credential revoked: ${run.state.credential_revoked}`);
console.log(`Mock control plane isolated: ${run.state.boundary_isolated}`);
console.log(`Restored release state: ${run.state.release_state}`);
console.log(`Recovery verified: ${run.state.recovery_verified}`);
console.log(`Exact retest result: ${run.phase5.result.result.toUpperCase()}`);
console.log(`Eligible for human deployment review: ${run.reviewPacket.eligible_for_human_review}`);
console.log('Deployment decision: PENDING HUMAN INPUT');
console.log('Evidence boundary: synthetic same-process recovery evidence; not independent operator, third-party, or production recovery assurance.');
