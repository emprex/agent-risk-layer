#!/usr/bin/env node
import { verifyCustomerReportBundle }
  from '../src/agent/customer-report-bundle-verifier.mjs';

// This is NOT a data-sharing, reviewer approval, or security verdict command.
// It reads an owner-controlled private report and never displays field values.
const args=process.argv.slice(2);
if (args.length!==1 || args[0]==='--help') {
  process.stderr.write(
    'Usage: npm run report:disclosure -- /absolute/private/path/arl-assessment-....manifest.json\n' +
    'Read-only disclosure indicators; human review remains mandatory.\n'
  );
  process.exit(args[0]==='--help' ? 0 : 2);
}
try {
  const result=verifyCustomerReportBundle(args[0],{disclosurePreflight:true});
  process.stdout.write(JSON.stringify({
    integrity:result.integrity,
    bundleSha256:result.bundleSha256,
    targetRevision:result.targetRevision,
    disclosurePreflight:result.disclosurePreflight
  },null,2)+'\n');
} catch {
  // Never echo filesystem path, input bytes, or parsed content in diagnostics.
  process.stderr.write('Disclosure preflight failed: private bundle not consistently verified.\n');
  process.exitCode=1;
}
