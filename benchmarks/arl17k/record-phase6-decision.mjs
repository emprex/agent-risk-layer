#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPhase6DeploymentDecision } from './phase6-decision.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'evidence', 'generated');
const defaultPacket = path.join(outputDir, 'phase6-deployment-review-packet.json');
const defaultOutput = path.join(outputDir, 'phase6-deployment-decision.json');

function value(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const decision = value('--decision');
const reviewer = value('--reviewer');
const rationale = value('--rationale');
const packetPath = path.resolve(value('--packet', defaultPacket));
const outputPath = path.resolve(value('--out', defaultOutput));

if (!decision || !reviewer) {
  console.error('Usage: npm run arl17k:phase6:decision -- --decision <proceed|hold|do_not_deploy> --reviewer <name-or-role> [--rationale <text>]');
  process.exitCode = 2;
} else {
  const reviewPacketBody = fs.readFileSync(packetPath, 'utf8');
  const reviewPacket = JSON.parse(reviewPacketBody);
  const record = recordPhase6DeploymentDecision({
    reviewPacket,
    reviewPacketBody,
    decision,
    reviewer,
    rationale,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`ARL17K Phase 6 deployment decision: ${outputPath}`);
  console.log(`Decision: ${record.decision}`);
  console.log(`Reviewer label: ${record.reviewer}`);
  console.log('Reviewer identity independently verified: false');
  console.log('Decision source: operator supplied; AgentRiskLayer did not make the deployment decision.');
}
