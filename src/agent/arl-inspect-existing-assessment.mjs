import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enableLocalCliMode } from './local-cli-mode.mjs';

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile?.(path.join(productRoot, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const evidenceJsonMode = process.argv[2] === '--evidence-json';
const packJsonMode = process.argv[2] === '--evidence-pack-json';
const jsonMode = process.argv[2] === '--json' || evidenceJsonMode || packJsonMode;
const targetArgument = jsonMode ? process.argv[3] : process.argv[2];
const packNumber = packJsonMode ? Number(process.argv[4]) : null;
const pageNumber = packJsonMode ? Number(process.argv[5] || '1') : null;
if (process.argv.length !== (packJsonMode ? (process.argv[5] ? 6 : 5) : jsonMode ? 4 : 3) ||
    !targetArgument?.trim() ||
    (packJsonMode && (!/^[1-9][0-9]*$/.test(process.argv[4] || '') ||
      !Number.isSafeInteger(packNumber) || packNumber > 150 ||
      !/^[1-9][0-9]*$/.test(process.argv[5] || '1') ||
      !Number.isSafeInteger(pageNumber) || pageNumber > 1000))) {
  console.error('Usage: npm run operator:inspect-existing -- [--json|--evidence-json] <existing-frozen-target-path>');
  process.exit(2);
}
if (process.env.NODE_ENV !== 'test' && !process.env.DATABASE_URL?.trim()) {
  console.error('Local PostgreSQL DATABASE_URL required. No assessment created.');
  process.exit(2);
}

try {
  process.env.ARL_LOCAL_MODE = '1';
  enableLocalCliMode(process.env);
  process.chdir(productRoot);
  const [
    { findExistingLocalAssessmentContext },
    { freezeLocalRepository },
    { showLocalAssessmentContext }
  ] = await Promise.all([
    import('./local-assessment-context.mjs'),
    import('./tools/freeze-local-repository.mjs'),
    import('./local-assessment-context-view.mjs')
  ]);

  const repositoryPath = path.resolve(targetArgument);
  const before = await freezeLocalRepository(repositoryPath);
  if (before.dirty || !/^[a-f0-9]{40}$/.test(before.revision || '')) {
    throw new Error('Existing assessment inspection requires a clean frozen Git target.');
  }
  const expected = process.env.ARL_EXPECTED_TARGET_SHA?.trim().toLowerCase();
  if (expected && (!/^[a-f0-9]{40}$/.test(expected) || expected !== before.revision)) {
    throw new Error('Requested frozen target SHA does not match the inspected repository.');
  }

  // This intentionally does not initialise the database or create a snapshot.
  const binding = await findExistingLocalAssessmentContext(repositoryPath);
  if (!binding) {
    if (evidenceJsonMode || packJsonMode) {
      const {existingEvidenceWorkplan} = await import('./existing-evidence-workplan.mjs');
      console.log(JSON.stringify(existingEvidenceWorkplan({
        frozenRevision:before.revision
      })));
    } else if (jsonMode) {
      const {existingAssessmentSummary} = await import('./existing-assessment-summary.mjs');
      console.log(JSON.stringify(existingAssessmentSummary({
        frozenRevision: before.revision,
        reason: 'not_found'
      })));
    } else {
      console.log('NO EXISTING LOCAL ASSESSMENT — nothing created. Use the separately authorised creation workflow.');
    }
  } else {
    const result = await showLocalAssessmentContext(binding);
    const after = await freezeLocalRepository(repositoryPath);
    if (after.dirty || after.revision !== before.revision) {
      throw new Error('Frozen target changed during read-only assessment inspection.');
    }
    if (result.canonicalData?.available === true &&
        result.canonicalData.targetBinding?.revision !== before.revision) {
      throw new Error('Recorded assessment snapshot does not match the frozen target SHA.');
    }
    if (evidenceJsonMode || packJsonMode) {
      if (result.canonicalData?.available !== true) {
        throw new Error('Existing authoritative scope unavailable for evidence review.');
      }
      // Only this declared read-only ARL command may be delegated.
      // It builds criterion-specific work plans; it never accepts evidence,
      // executes tests, bootstraps state or records decisions.
      const {runLocalAssessment} = await import('./local-assessment-workflow.mjs');
      const requests = await runLocalAssessment(
        repositoryPath, packJsonMode ? `Show assessment evidence request pack ${packNumber} page ${pageNumber}` : 'Show assessment evidence requests', binding
      );
      const {existingEvidenceWorkplan} = await import('./existing-evidence-workplan.mjs');
      const updatedScope = await showLocalAssessmentContext(binding);
      const finalFreeze = await freezeLocalRepository(repositoryPath);
      if (finalFreeze.dirty || finalFreeze.revision !== before.revision) {
        throw new Error('Frozen target changed during evidence workplan review.');
      }
      if (packJsonMode) {
        const {existingEvidencePackPage} = await import('./existing-evidence-pack-page.mjs');
        console.log(JSON.stringify(existingEvidencePackPage({
          frozenRevision:before.revision, binding,
          scopeBefore:result.canonicalData,
          scopeAfter:updatedScope.canonicalData,
          requests, packNumber, pageNumber
        })));
      } else {
        console.log(JSON.stringify(existingEvidenceWorkplan({
          frozenRevision:before.revision,
          binding,
          scopeBefore:result.canonicalData,
          scopeAfter:updatedScope.canonicalData,
          requests
        })));
      }
    } else if (jsonMode) {
      const {existingAssessmentSummary} = await import('./existing-assessment-summary.mjs');
      console.log(JSON.stringify(existingAssessmentSummary({
        view: result.canonicalData,
        binding,
        frozenRevision: before.revision
      })));
    } else {
      console.log(result.answer);
    }
    if (!result.canonicalData?.available) process.exitCode = 1;
  }
} catch (error) {
  console.error('EXISTING ASSESSMENT INSPECTION BLOCKED: ' + String(error?.message || 'Unknown error'));
  console.error('No assessment was created or changed by this command.');
  process.exitCode = 2;
}
