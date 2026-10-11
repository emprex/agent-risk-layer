import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enableLocalCliMode } from './local-cli-mode.mjs';

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile?.(path.join(productRoot, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
if (process.argv.length !== 3 || !process.argv[2]?.trim()) {
  console.error('Usage: npm run operator:inspect-existing -- <existing-frozen-target-path>');
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

  const repositoryPath = path.resolve(process.argv[2]);
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
    console.log('NO EXISTING LOCAL ASSESSMENT — nothing created. Use the separately authorised creation workflow.');
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
    console.log(result.answer);
    if (!result.canonicalData?.available) process.exitCode = 1;
  }
} catch (error) {
  console.error('EXISTING ASSESSMENT INSPECTION BLOCKED: ' + String(error?.message || 'Unknown error'));
  console.error('No assessment was created or changed by this command.');
  process.exitCode = 2;
}
