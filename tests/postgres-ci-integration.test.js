import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPostgresDatabase } from '../src/db-adapters/postgres.js';
import { runMigrations } from '../src/migrations.js';

const root = path.resolve(import.meta.dirname, '..');
const url = process.env.ARL_CI_POSTGRES_URL || '';

// This test must never accept a real workstation or hosted customer DB.
// GitHub Actions supplies a disposable postgres:16 service just for this job.
function ephemeralCiUrl() {
  assert.equal(process.env.CI, 'true', 'The live PostgreSQL smoke test runs only in CI.');
  const parsed = new URL(url);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/arl_ci');
  assert.equal(parsed.username, 'arl_ci');
  assert.equal(parsed.search, '');
  return url;
}

test('ephemeral PostgreSQL refuses unsupported review export and stale target SHA', {
  skip: !url && 'Only the dedicated CI PostgreSQL service is authorized.',
  timeout: 150_000
}, async () => {
  const connectionString = ephemeralCiUrl();
  const config = {
    databaseUrl: connectionString,
    databasePoolMax: 3,
    databaseIdleTimeoutMs: 5_000,
    databaseConnectTimeoutMs: 10_000,
    databaseSsl: false,
    databaseSslRejectUnauthorized: true,
    nodeEnv: 'test',
    databaseStatementTimeoutMs: 60_000,
    databaseLockTimeoutMs: 10_000
  };
  const db = await createPostgresDatabase(config);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-ci-postgres-target-'));
  const target = path.join(temp, 'target');
  const git = args => spawnSync('git', ['-C', target, ...args], {
    encoding: 'utf8',
    timeout: 10_000
  });

  try {
    // This is a dedicated empty CI database; never drop or reset a customer DB.
    const files = fs.readdirSync(path.join(root, 'migrations'))
      .filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
    const first = await runMigrations(db);
    assert.deepEqual(first.applied, files);
    assert.deepEqual(first.skipped, []);
    const repeated = await runMigrations(db);
    assert.deepEqual(repeated.skipped, files);
    assert.deepEqual(repeated.applied, []);

    const migrations = await db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get();
    assert.equal(Number(migrations.count), files.length);
    const catalogue = await db.prepare('SELECT COUNT(*) AS count FROM risk_knowledge_entries').get();
    assert.equal(Number(catalogue.count), 108);

    // Real PostgreSQL: complete artifact round-trip, immutable idempotency and
    // failed transaction rollback on a disposable CI database only.
    const collection = JSON.stringify({
      schema:'arl.deterministic-evidence-collection.v1',
      targetRevision:'a'.repeat(40),
      privacyBoundary:'No source code, secret values, credential values or raw external destination names are included.',
      requirementObservations:[{requirement:'KB-016',collectors:['target_identity'],
        observations:{target_identity:{revision:'a'.repeat(40)}}}]
    });
    const digest = crypto.createHash('sha256').update(collection).digest('hex');
    const ref='arl_frozen_source_evidence_collection_v2:'+'a'.repeat(40)+':ARL-KB-016:'+'b'.repeat(64);
    const args=['sca_ci_1','ws_ci','prj_ci','sys_ci','ARL-KB-016','a'.repeat(40),ref,
      digest,collection,'arl.deterministic-evidence-collection.v1',new Date().toISOString()];
    const insert='INSERT INTO control_source_collection_artifacts '+
      '(id,workspace_id,project_id,system_snapshot_id,entry_id,target_revision,input_reference,'+
      'collection_sha256,collection_json,collector_schema,created_at) '+
      'VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING';
    await db.prepare(insert).run(...args);
    await db.prepare(insert).run(...args);
    const stored = await db.prepare('SELECT * FROM control_source_collection_artifacts WHERE id=?').get(args[0]);
    assert.equal(stored.collection_json,collection);
    assert.equal(stored.collection_sha256,digest);
    assert.equal(stored.retention_status,'active');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM control_source_collection_artifacts').get()).count,1);
    await assert.rejects(db.transaction(async()=>{
      await db.prepare(insert).run('sca_ci_rollback',...args.slice(1));
      throw new Error('synthetic rollback');
    }),/synthetic rollback/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM control_source_collection_artifacts').get()).count,1);
    await db.prepare("UPDATE control_source_collection_artifacts SET retention_status='expired' WHERE id=?").run(args[0]);
    assert.equal((await db.prepare('SELECT retention_status FROM control_source_collection_artifacts WHERE id=?').get(args[0])).retention_status,'expired');

    // The retired hosted billing tables must not survive the full migration chain.
    const retired = await db.prepare(
      "SELECT to_regclass('public.purchases') AS purchases, to_regclass('public.subscriptions') AS subscriptions"
    ).get();
    assert.equal(retired.purchases, null);
    assert.equal(retired.subscriptions, null);

    fs.mkdirSync(target);
    assert.equal(git(['init', '-q']).status, 0);
    assert.equal(git(['config', 'user.email', 'synthetic-ci@example.invalid']).status, 0);
    assert.equal(git(['config', 'user.name', 'ARL Synthetic CI']).status, 0);
    fs.writeFileSync(path.join(target,'README.md'), '# Synthetic, no customer target or credentials\n');
    assert.equal(git(['add', '.']).status, 0);
    assert.equal(git(['-c','commit.gpgsign=false','commit','-qm','Synthetic CI target']).status, 0);
    const revision = git(['rev-parse','HEAD']).stdout.trim();
    assert.match(revision,/^[a-f0-9]{40}$/);
    assert.equal(git(['status','--porcelain']).stdout.trim(), '');

    const result = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs',
      target,
      'Where are we?'
    ], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PRODUCT_STAGE: 'development',
        ARL_LOCAL_MODE: '1',
        ARL_AI_ADVISORY: '0',
        DATABASE_URL: connectionString,
        ARL_EXPECTED_TARGET_SHA: revision
      },
      encoding: 'utf8',
      timeout: 90_000
    });

    assert.equal(result.status,0,
      'Local Operator PostgreSQL preflight failed:\n' +
      result.stdout.slice(-6_000) + '\n' + result.stderr.slice(-6_000));
    assert.match(result.stdout,/ARL LOCAL ASSESSMENT ANSWER/);
    assert.doesNotMatch(result.stdout,/deployment (?:authorised|approved)|release approved/i);

    // This entry point is read-only even on real PostgreSQL. A prepared
    // synthetic assessment may be opened, but neither it nor an unknown
    // target is allowed to initialise a new user, project or snapshot.
    const operatorCount = async (table) => Number((await db.prepare(
      'SELECT COUNT(*) AS count FROM ' + table
    ).get()).count);
    const operatorTables = [
      'users', 'security_projects', 'assessments',
      'system_snapshots', 'control_snapshot_evaluations'
    ];
    const operatorStateBefore = await Promise.all(operatorTables.map(operatorCount));
    const reviewDirectory=path.join(temp,'review-output');
    const fakeBin=path.join(temp,'fake-bin');
    fs.mkdirSync(reviewDirectory,{mode:0o700});
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin,'xdg-open'),'#!/bin/sh\nexit 0\n',{mode:0o755});

    const openExisting = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs', target
    ], {
      cwd: root, encoding: 'utf8', timeout: 90_000,
      env: {
        ...process.env,
        NODE_ENV: 'test', PRODUCT_STAGE: 'development',
        ARL_LOCAL_MODE: '1', ARL_AI_ADVISORY: '0',
        ARL_OPERATOR_OPEN_DASHBOARD: '1',
        ARL_REPORT_OUTPUT_DIR: reviewDirectory,
        PATH: fakeBin + path.delimiter + (process.env.PATH || ''),
        DATABASE_URL: connectionString,
        ARL_EXPECTED_TARGET_SHA: revision
      }
    });
    assert.equal(openExisting.status, 0,
      'existing dashboard opener failed: ' + openExisting.stderr);
    assert.match(openExisting.stdout,/Offline operator review dashboard created/);
    const openedFiles = fs.readdirSync(reviewDirectory);
    assert.equal(openedFiles.length,1);
    const openedHtml = fs.readFileSync(path.join(reviewDirectory,openedFiles[0]),'utf8');
    assert.match(openedHtml,/All 108 controls — authoritative snapshot/);
    assert.match(openedHtml,/All 0 independent controls/);
    assert.match(openedHtml,/Deployment HOLD/);
    assert.deepEqual(await Promise.all(operatorTables.map(operatorCount)),
      operatorStateBefore, 'opening an existing assessment cannot mutate authoritative PostgreSQL entities');

    const unpreparedTarget = path.join(temp, 'unknown-operator-target');
    fs.mkdirSync(unpreparedTarget);
    const openUnknown = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs', unpreparedTarget
    ], {
      cwd: root, encoding: 'utf8', timeout: 90_000,
      env: {
        ...process.env,
        NODE_ENV: 'test', PRODUCT_STAGE: 'development',
        ARL_LOCAL_MODE: '1', ARL_AI_ADVISORY: '0',
        ARL_OPERATOR_OPEN_DASHBOARD: '1',
        ARL_REPORT_OUTPUT_DIR: reviewDirectory,
        PATH: fakeBin + path.delimiter + (process.env.PATH || ''),
        DATABASE_URL: connectionString,
        ARL_EXPECTED_TARGET_SHA: revision
      }
    });
    assert.equal(openUnknown.status, 2);
    assert.match(openUnknown.stderr, /No existing local assessment for this target/);
    assert.deepEqual(await Promise.all(operatorTables.map(operatorCount)),
      operatorStateBefore, 'unknown target must not silently initialise anything in PostgreSQL');

    // A second, read-only export must reuse the exact frozen assessment
    // and identical private HTML in real PostgreSQL.
    const review=spawnSync(process.execPath,[
      'src/agent/arl-local-assessment-runner.mjs',
      target,
      'Export assessment operator dashboard'
    ],{
      cwd:root,
      env:{
        ...process.env,
        NODE_ENV:'test',
        PRODUCT_STAGE:'development',
        ARL_LOCAL_MODE:'1',
        ARL_AI_ADVISORY:'0',
        ARL_OPERATOR_OPEN_DASHBOARD:'0',
        ARL_REPORT_OUTPUT_DIR:reviewDirectory,
        DATABASE_URL:connectionString,
        ARL_EXPECTED_TARGET_SHA:revision
      },
      encoding:'utf8',
      timeout:90_000
    });
    // No human-prepared evidence is fabricated for a newly created snapshot.
    assert.equal(review.status,0,'second export failed: '+review.stderr);
    assert.match(review.stdout,/Offline operator review dashboard unchanged/);
    assert.equal(fs.readdirSync(reviewDirectory).length,1,
      'Only one immutable snapshot-bound review dashboard may be exported');
    assert.equal(fs.statSync(reviewDirectory).mode & 0o777,0o700);
    assert.equal(git(['status','--porcelain']).stdout.trim(),'',
      'The exact frozen synthetic target must remain unchanged');

    // A changed synthetic Git commit is a DIFFERENT target. It must never
    // reuse the earlier authoritative revision without revalidation.
    fs.appendFileSync(path.join(target,'README.md'),
      '\n# Synthetic second revision; not a customer target\n');
    assert.equal(git(['add','README.md']).status,0);
    assert.equal(git(['-c','commit.gpgsign=false','commit','-qm','Changed synthetic target']).status,0);
    const changedRevision=git(['rev-parse','HEAD']).stdout.trim();
    assert.notEqual(changedRevision,revision);
    const stale=spawnSync(process.execPath,[
      'src/agent/arl-local-assessment-runner.mjs',
      target,
      'Export assessment operator dashboard'
    ],{
      cwd:root,
      env:{
        ...process.env,
        NODE_ENV:'test',
        PRODUCT_STAGE:'development',
        ARL_LOCAL_MODE:'1',
        ARL_AI_ADVISORY:'0',
        ARL_OPERATOR_OPEN_DASHBOARD:'0',
        ARL_REPORT_OUTPUT_DIR:reviewDirectory,
        DATABASE_URL:connectionString,
        ARL_EXPECTED_TARGET_SHA:revision
      },
      encoding:'utf8',
      timeout:90_000
    });
    assert.equal(stale.status,2);
    assert.match(stale.stderr,/Local assessment frozen target mismatch/);
    assert.equal(fs.readdirSync(reviewDirectory).length,1,
      'A changed target must not create another trusted old-revision dossier');

    const owners = await db.prepare('SELECT COUNT(*) AS count FROM users WHERE email LIKE ?').get('%@local.invalid');
    assert.equal(Number(owners.count),1);
    const snapshots = await db.prepare('SELECT COUNT(*) AS count FROM system_snapshots').get();
    assert.ok(Number(snapshots.count)>=1);
    // Retention lifecycle uses the real worker and isolated PostgreSQL fixture.
    const project = await db.prepare("SELECT id,workspace_id FROM security_projects WHERE status!='archived' LIMIT 1").get();
    assert.ok(project, 'synthetic Operator creates a project for retention coverage');
    const old = '2020-01-01T00:00:00.000Z';
    const revised = 'c'.repeat(40);
    const retainedJson = JSON.stringify({
      schema:'arl.deterministic-evidence-collection.v1',targetRevision:revised,
      privacyBoundary:'No source code, secret values, credential values or raw external destination names are included.',
      requirementObservations:[]
    });
    const retainedDigest = crypto.createHash('sha256').update(retainedJson).digest('hex');
    for (const [key,status] of [['purge','active'],['hold','retained_hold']]) {
      await db.prepare(
        'INSERT INTO control_source_collection_artifacts '+
        '(id,workspace_id,project_id,system_snapshot_id,entry_id,target_revision,input_reference,'+
        'collection_sha256,collection_json,collector_schema,retention_status,retention_expires_at,created_at) '+
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run('sca_ci_'+key,project.workspace_id,project.id,'sys_synthetic','ARL-KB-016',revised,
        'ci-retention-'+key,retainedDigest,retainedJson,'arl.deterministic-evidence-collection.v1',
        status,old,old);
    }
    const retention = spawnSync(process.execPath,[
      '--input-type=module','--eval',
      "import { enforceRetention } from './src/retention.js'; import { db } from './src/db.js'; try { const x = await enforceRetention(); console.log(JSON.stringify({sourceCollectionArtifactsPurged:x.sourceCollectionArtifactsPurged})); } finally { await db.close(); }"
    ],{cwd:root,env:{...process.env,NODE_ENV:'test',DATABASE_URL:connectionString},
      encoding:'utf8',timeout:60_000});
    assert.equal(retention.status,0,'Synthetic retention worker failed: '+retention.stderr.slice(-1500));
    assert.ok(JSON.parse(retention.stdout.trim()).sourceCollectionArtifactsPurged>=1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM control_source_collection_artifacts WHERE id=?').get('sca_ci_purge')).count,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM control_source_collection_artifacts WHERE id=?').get('sca_ci_hold')).count,1);
    const activeTests = await db.prepare('SELECT COUNT(*) AS count FROM control_test_executions').get();
    assert.equal(Number(activeTests.count),0,
      'Review HTML and a rejected changed SHA must never execute a controlled test.');
    const redteamRuns = await db.prepare('SELECT COUNT(*) AS count FROM redteam_runs').get();
    assert.equal(Number(redteamRuns.count),0);
    const decisions = await db.prepare('SELECT COUNT(*) AS count FROM control_deployment_decisions').get();
    assert.equal(Number(decisions.count),0,
      'Synthetic Operator bootstrapping must not write a deployment decision.');
  } finally {
    await db.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
