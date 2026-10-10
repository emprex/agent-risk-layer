#!/usr/bin/env node
import { verifyCustomerReportBundle }
  from '../src/agent/customer-report-bundle-verifier.mjs';

// No database, network, credential or customer authority imports.
// Only the exact private manifest supplied by the operator is inspected.
const args=process.argv.slice(2);
if (args.length !== 1 || args[0]==='--help') {
  process.stderr.write(
    'Usage: npm run report:verify -- /absolute/private/path/arl-assessment-....manifest.json\n' +
    'Checks content consistency only; not signatures, evidence validity, findings or release authority.\n'
  );
  process.exit(args[0]==='--help'?0:2);
}

try {
  const result=verifyCustomerReportBundle(args[0]);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch (error) {
  process.stderr.write('Report file consistency NOT established. '+
    String(error?.message || 'Unknown validation error')+'\n');
  process.exitCode=1;
}
