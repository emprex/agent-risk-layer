import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enableLocalCliMode
} from './local-cli-mode.mjs';

const productRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

try {
  process.loadEnvFile?.(path.join(productRoot, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const repositoryArgument = String(process.argv[2] || '').trim();
const request =
  process.argv.slice(3).join(' ').trim() ||
  'Assess this agent';

if (!repositoryArgument) {
  console.error(
    'Usage: npm run assess:local -- <repository-path> "<request>"'
  );
  process.exit(1);
}

const repositoryPath = path.resolve(repositoryArgument);

try {
  // This executable enables local Operator authority only.
  // Persistence remains PostgreSQL through DATABASE_URL.
  process.env.ARL_LOCAL_MODE = '1';
  enableLocalCliMode(process.env);
  if (
    process.env.NODE_ENV !== 'test' &&
    !String(process.env.DATABASE_URL || '').trim()
  ) {
    throw new Error(
      'DATABASE_URL is required for local PostgreSQL persistence.'
    );
  }
} catch (error) {
  console.error('ARL LOCAL ASSESSMENT PREFLIGHT FAILED');
  console.error('');
  console.error(
    `- ${error?.message || 'Local CLI mode could not be enabled.'}`
  );
  process.exit(2);
}

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
    { runArlAgent },
    {
      explainAssessmentState
    },
    {
      isAssessmentStateExplanationRequest
    }
  ] = await Promise.all([
    import('./local-assessment-context.mjs'),
    import('./tools/inspect-frozen-repository.mjs'),
    import('./frozen-inspection-transport.mjs'),
    import('./initial-assessment-snapshot.mjs'),
    import('./local-assessment-workflow.mjs'),
    import('./customer-assessment-deliverable.mjs'),
    import('./arl-operational-orchestrator.mjs'),
    import('./ai/assessment-explainer.mjs'),
    import('./ai/advisory-context.mjs')
  ]);

  const frozen = await inspectFrozenRepository(repositoryPath);
  const suppliedExpectedRevision = String(
    process.env.ARL_EXPECTED_TARGET_SHA || ''
  ).trim().toLowerCase();

  if (
    suppliedExpectedRevision &&
    !/^[a-f0-9]{40}$/.test(suppliedExpectedRevision)
  ) {
    throw new Error(
      'ARL_EXPECTED_TARGET_SHA must be an exact 40-character Git commit SHA when supplied.'
    );
  }

  const expectedRevision =
    suppliedExpectedRevision || frozen.target.revision;

  if (frozen.target.revision !== expectedRevision) {
    throw new Error(
      `Local assessment frozen target mismatch: expected ${expectedRevision}, actual ${frozen.target.revision}.`
    );
  }

  process.env.ARL_EXPECTED_TARGET_SHA = expectedRevision;

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
    const explainCurrentState =
      isAssessmentStateExplanationRequest(request);
    const workflowRequest =
      explainCurrentState
        ? 'Where are we?'
        : request;

    const result =
      await runLocalAssessment(
        repositoryPath,
        workflowRequest,
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

    if (
      explainCurrentState &&
      process.env.ARL_AI_ADVISORY !== '0'
    ) {
      try {
        const advisory =
          await explainAssessmentState(
            result.canonicalData
          );

        console.log(
          '\n=== AI ADVISORY EXPLANATION ===\n'
        );

        if (advisory.available) {
          console.log('Authoritative facts supplied to the model:');
          for (const fact of advisory.facts || []) {
            console.log(`[${fact.id}] ${fact.text}`);
          }
          console.log('');
          console.log('Model commentary:');
          console.log(advisory.explanation);
          console.log('');
          console.log(
            'Advisory only — authoritative ARL state and human decision remain unchanged.'
          );
        } else {
          console.log(
            `AI unavailable (${advisory.reason}). Authoritative ARL workflow continues normally.`
          );
        }
      } catch {
        console.log(
          '\n=== AI ADVISORY EXPLANATION ===\n'
        );
        console.log(
          'AI unavailable. Authoritative ARL workflow continues normally.'
        );
      }
    }
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
