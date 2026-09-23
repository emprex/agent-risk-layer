import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enableLocalCliMode
} from './local-cli-mode.mjs';

const repositoryArgument = String(process.argv[2] || '').trim();
const request =
  process.argv.slice(3).join(' ').trim() ||
  'Assess this agent';

if (!repositoryArgument) {
  console.error(
    'Usage: ARL_LOCAL_MODE=1 ARL_EXPECTED_TARGET_SHA=<40-char-sha> npm run assess:local -- <repository-path> "<request>"'
  );
  process.exit(1);
}

const repositoryPath = path.resolve(repositoryArgument);

try {
  enableLocalCliMode(process.env);
} catch (error) {
  console.error('ARL LOCAL ASSESSMENT PREFLIGHT FAILED');
  console.error('');
  console.error(
    `- ${error?.message || 'Local CLI mode could not be enabled.'}`
  );
  process.exit(2);
}

const productRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

// Product assets and official runner digests resolve against the canonical
// AgentRiskLayer checkout, never against the assessed target.
process.chdir(productRoot);

try {
  const [
    { resolveLocalAssessmentContext },
    { inspectFrozenRepository },
    { buildFrozenInspectionTransport },
    { ensureInitialAssessmentSnapshot },
    { runLocalAssessment },
    {
      buildCustomerAssessmentDeliverable,
      detectCustomerAssessmentDeliverableCommand,
      publicCustomerAssessmentDeliverable,
      writeCustomerAssessmentDeliverable
    },
    { runArlAgent }
  ] = await Promise.all([
    import('./local-assessment-context.mjs'),
    import('./tools/inspect-frozen-repository.mjs'),
    import('./frozen-inspection-transport.mjs'),
    import('./initial-assessment-snapshot.mjs'),
    import('./local-assessment-workflow.mjs'),
    import('./customer-assessment-deliverable.mjs'),
    import('./arl-operational-orchestrator.mjs')
  ]);

  const frozen = await inspectFrozenRepository(repositoryPath);
  const expectedRevision = String(
    process.env.ARL_EXPECTED_TARGET_SHA || ''
  ).trim().toLowerCase();

  if (!/^[a-f0-9]{40}$/.test(expectedRevision)) {
    throw new Error(
      'ARL_EXPECTED_TARGET_SHA must be the exact 40-character frozen Git commit SHA.'
    );
  }
  if (frozen.target.revision !== expectedRevision) {
    throw new Error(
      `Local assessment frozen target mismatch: expected ${expectedRevision}, actual ${frozen.target.revision}.`
    );
  }

  const options =
    await resolveLocalAssessmentContext(repositoryPath);

  await ensureInitialAssessmentSnapshot({
    operatorContextInternal: options,
    frozenInspection:
      buildFrozenInspectionTransport(frozen)
  });

  const deliverableCommand =
    detectCustomerAssessmentDeliverableCommand(request);

  if (deliverableCommand) {
    const reportResult = await runArlAgent(
      repositoryPath,
      'Show assessment report',
      options
    );
    const report =
      reportResult?.canonicalData
        ?.customerAssessmentReport || null;

    if (report?.available !== true) {
      console.log(
        '\n=== ARL LOCAL ASSESSMENT ANSWER ===\n'
      );
      console.log(reportResult.answer);
      process.exitCode = 1;
    } else {
      const deliverable =
        buildCustomerAssessmentDeliverable(report);
      const writeResult =
        writeCustomerAssessmentDeliverable({
          deliverable,
          outputDirectory:
            process.env.ARL_REPORT_OUTPUT_DIR ||
            path.join(productRoot, 'data/local-reports')
        });

      if (process.env.ARL_DEBUG_CANONICAL === '1') {
        console.log(
          '\n=== ARL LOCAL CANONICAL RESULT ===\n'
        );
        console.log(JSON.stringify({
          type: 'customer_assessment_deliverable',
          command: deliverableCommand,
          customerAssessmentDeliverable:
            publicCustomerAssessmentDeliverable(deliverable),
          customerAssessmentDeliverableWrite: {
            ...writeResult,
            files: writeResult.files.map((file) => ({
              name: file.name,
              sha256: file.sha256,
              bytes: file.bytes,
              status: file.status
            }))
          },
          securityStateChanged: false,
          deploymentDecisionWritten: false,
          humanReviewRequired: true
        }, null, 2));
      }

      console.log(
        '\n=== ARL LOCAL ASSESSMENT ANSWER ===\n'
      );
      console.log([
        'CUSTOMER ASSESSMENT DELIVERABLE',
        '',
        `Output directory: ${writeResult.outputDirectory}`,
        ...writeResult.files.map((file) =>
          `${file.name} — ${file.status} — sha256:${file.sha256}`
        ),
        '',
        `Bundle SHA-256: ${deliverable.bundleSha256}`,
        'Human final deployment decision remains required.',
        'No deployment decision was written by the export.'
      ].join('\n'));
    }
  } else {
    const result =
      await runLocalAssessment(
        repositoryPath,
        request,
        options
      );

    if (process.env.ARL_DEBUG_CANONICAL === '1') {
      console.log(
        '\n=== ARL LOCAL CANONICAL RESULT ===\n'
      );
      console.log(
        JSON.stringify(result.canonicalData, null, 2)
      );
    }

    console.log(
      '\n=== ARL LOCAL ASSESSMENT ANSWER ===\n'
    );
    console.log(result.answer);
  }
} catch (error) {
  console.error('ARL LOCAL ASSESSMENT FAILED');
  console.error('');
  console.error(
    `- ${error?.message || 'Local assessment failed.'}`
  );
  console.error('');
  console.error(
    'No deployment decision was written by the failed local assessment.'
  );
  process.exit(2);
}
