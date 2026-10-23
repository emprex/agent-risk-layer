// Explicit, synthetic LAB-ONLY first-assessment preparation.
// This entry point deliberately exposes no generic assessment instruction,
// controlled test, evidence approval or deployment decision.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const SCHEMA='arl.operator.lab-preparation.v1';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function refuse(message) {
  console.error('ARL LAB PREPARATION REFUSED: '+message);
  process.exitCode=2;
}

function labDatabaseGuard(env=process.env) {
  if (env.NODE_ENV==='test' && env.PRODUCT_STAGE==='development' &&
      env.DATABASE_PATH && !env.DATABASE_URL) {
    return {testFixture:true};
  }
  const candidate=String(env.ARL_OPERATOR_LAB_DATABASE_URL||'');
  let url;
  try {url=new URL(candidate);} catch {throw new Error('Dedicated local lab PostgreSQL URL required.');}
  if (!['postgresql:','postgres:'].includes(url.protocol) ||
      !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
      decodeURIComponent(url.pathname)!=='/arl_operator_lab') {
    throw new Error('Lab database must be the local PostgreSQL database arl_operator_lab.');
  }
  if (env.NODE_ENV==='test') {
    throw new Error('Test mode may not be used with the operator PostgreSQL lab.');
  }
  // The ordinary ARL DATABASE_URL and .env are never used for this write.
  process.env.DATABASE_URL=candidate;
  return {testFixture:false};
}

try {
  if (process.argv.length!==4 || process.argv[2]!=='--lab-prepare') {
    throw new Error('Usage: node src/agent/arl-prepare-lab-assessment.mjs --lab-prepare <clean-synthetic-git-path>');
  }
  const expected=String(process.env.ARL_EXPECTED_TARGET_SHA||'').trim().toLowerCase();
  if (!SHA.test(expected)) throw new Error('Exact pinned target SHA required.');
  if (process.env.ARL_OPERATOR_LAB_ONLY!=='1' ||
      process.env.ARL_LAB_PREPARE_CONFIRMATION!==('PREPARE LAB '+expected)) {
    throw new Error('Explicit LAB-only confirmation and exact target SHA required.');
  }
  labDatabaseGuard();
  process.env.ARL_LOCAL_MODE='1';
  process.env.ARL_AI_ADVISORY='0';
  process.env.ARL_OPERATOR_OPEN_DASHBOARD='0';
  const repositoryPath=path.resolve(process.argv[3]);
  const {enableLocalCliMode}=await import('./local-cli-mode.mjs');
  enableLocalCliMode(process.env);
  const [
    {freezeLocalRepository},
    {inspectFrozenRepository},
    {buildFrozenInspectionTransport},
    {resolveLocalAssessmentContext,findExistingLocalAssessmentContext},
    {ensureInitialAssessmentSnapshot}
  ]=await Promise.all([
    import('./tools/freeze-local-repository.mjs'),
    import('./tools/inspect-frozen-repository.mjs'),
    import('./frozen-inspection-transport.mjs'),
    import('./local-assessment-context.mjs'),
    import('./initial-assessment-snapshot.mjs')
  ]);
  process.chdir(root);
  const before=await freezeLocalRepository(repositoryPath);
  if (before.dirty || before.revision!==expected)
    throw new Error('Synthetic Git target must be clean and exactly pinned.');
  // Only this dedicated lab database may be initialised/migrated, and
  // only after the operator's exact target confirmation and freeze checks.
  const {initialiseDatabase}=await import('../db.js');
  await initialiseDatabase();
  // Refuse existing assessments. No silent rescope, update, or rebootstrap.
  if (await findExistingLocalAssessmentContext(repositoryPath)) {
    throw new Error('This target already has an assessment. Inspect existing instead.');
  }
  const frozen=await inspectFrozenRepository(repositoryPath);
  if (frozen.target.dirty!==false || frozen.target.revision!==expected ||
      frozen.binding.verified!==true)
    throw new Error('Frozen inspection and target revision mismatch.');
  const afterInspection=await freezeLocalRepository(repositoryPath);
  if (afterInspection.dirty || afterInspection.revision!==expected)
    throw new Error('Target changed before lab assessment preparation.');
  // The following two canonical calls create initial records in the
  // dedicated isolated lab database. No general assessment command runs.
  const binding=await resolveLocalAssessmentContext(repositoryPath);
  const snapshot=await ensureInitialAssessmentSnapshot({
    operatorContextInternal:binding,
    frozenInspection:buildFrozenInspectionTransport(frozen)
  });
  if (snapshot.available!==true || snapshot.created!==true ||
      snapshot.revision!==expected ||
      snapshot.deploymentDecisionWritten!==false ||
      snapshot.humanReviewRequired!==true ||
      ![binding.userId,binding.projectId,binding.assessmentId].every(x=>ID.test(x))) {
    throw new Error('Initial lab assessment preparation incomplete; inspect lab records manually.');
  }
  const after=await freezeLocalRepository(repositoryPath);
  if (after.dirty || after.revision!==expected)
    throw new Error('Target changed during lab preparation; new records require manual review.');
  console.log(JSON.stringify({
    schema:SCHEMA,available:true,created:true,labOnly:true,
    targetRevision:expected,projectId:binding.projectId,
    assessmentId:binding.assessmentId,
    snapshotState:'unknown_requires_human_review',
    evidenceAccepted:false,testsExecuted:0,findingsApproved:false,
    securityStateChanged:true, // initial records were created, not security approval
    deploymentDecisionWritten:false,humanReviewRequired:true,
    securityVerdict:'not_assessed',readinessDecision:'HOLD'
  }));
} catch {
  // Never print driver output, SQL, credentials or arbitrary exception text.
  refuse('Prerequisite, frozen target or dedicated lab operation failed. Check local lab configuration and logs.');
}
