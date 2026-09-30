import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const testUrl = process.env.TEST_DATABASE_URL || '';
const productionUrl = process.env.DATABASE_URL || '';

assert.ok(testUrl, 'TEST_DATABASE_URL is required.');
assert.notEqual(
  testUrl,
  productionUrl,
  'TEST_DATABASE_URL must not equal DATABASE_URL.'
);

const parsed = new URL(testUrl);

assert.ok(
  ['127.0.0.1','localhost'].includes(parsed.hostname),
  'KB-004 PostgreSQL test requires loopback-only PostgreSQL.'
);

assert.match(
  parsed.pathname.slice(1),
  /(?:test|disposable)/i,
  'Database name must explicitly identify a test database.'
);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_SSL = 'false';
process.env.ADMIN_EMAIL = '';

const admin = new pg.Client({ connectionString:testUrl });
await admin.connect();

const reset = async () => {
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE');
  await admin.query('CREATE SCHEMA public');
};

await reset();

try {
  const { db, initialiseDatabase, nowIso } =
    await import('../src/db.js');

  const { createWorkspace } =
    await import('../src/workspaces.js');

  const { createSecurityProject } =
    await import('../src/control-plane.js');

  const {
    createSystemSnapshot,
    recordSystemRiskClassification,
    getSystemRiskClassification,
  } = await import('../src/control-intelligence.js');

  const migration = await initialiseDatabase();

  assert.ok(
    migration.migrations.applied.includes(
      '023_system_risk_classification.sql'
    )
  );

  const userId =
    `usr_kb004_${crypto.randomUUID().replaceAll('-','')}`;

  const timestamp = nowIso();

  await db.prepare(`
    INSERT INTO users
      (id,email,password_hash,email_verified_at,created_at)
    VALUES (?,?,?,?,?)
  `).run(
    userId,
    `${userId}@example.test`,
    'test-only',
    timestamp,
    timestamp
  );

  const workspace =
    await createWorkspace(userId, 'KB-004 workspace');

  const project = await createSecurityProject({
    userId,
    workspaceId:workspace.id,
    name:'KB-004 target',
    environment:'test',
  });

  const first = await createSystemSnapshot({
    projectId:project.id,
    userId,
    input:{
      architecture:{ summary:'bounded local MCP agent' },
      tools:[
        {
          name:'local_file_manager',
          authority:'bounded local file read/write',
        },
      ],
      dataSources:[
        {
          name:'approved local test directory',
          classification:'test-data',
        },
      ],
      autonomyLevel:'autonomous',
      source:'kb004-test',
    },
  });

  const completeImpact = {
    authority:'Bounded local file read/write authority.',
    reachableAssets:[
      'Approved local test directory',
    ],
    dataExposure:'Synthetic/local test data only.',
    maximumAction:
      'Create or overwrite one approved local test file.',
    reversibility:
      'File mutation is locally recoverable where a prior copy exists.',
    scale:'Single local operator and bounded local directory.',
    affectedPeople:
      'Single authorised local test operator.',
    dependencyChains:[
      'Local filesystem and local MCP file-manager only.',
    ],
  };

  await assert.rejects(
    () => recordSystemRiskClassification({
      projectId:project.id,
      userId,
      input:{
        systemSnapshotId:first.snapshot.id,
        declaredRiskTier:'low',
        impactRequiredTier:'high',
        decision:'aligned',
        maximumCredibleImpact:completeImpact,
        evidenceReferences:['kb004:test:mismatch'],
        rationale:
          'Intentional negative case proving inconsistent human decisions are rejected.',
      },
    }),
    /expected underclassified/i
  );

  await assert.rejects(
    () => recordSystemRiskClassification({
      projectId:project.id,
      userId,
      input:{
        systemSnapshotId:first.snapshot.id,
        declaredRiskTier:'medium',
        impactRequiredTier:'medium',
        decision:'aligned',
        maximumCredibleImpact:{
          ...completeImpact,
          reachableAssets:[],
        },
        evidenceReferences:['kb004:test:missing-impact'],
        rationale:
          'Intentional negative case proving incomplete impact evidence is rejected.',
      },
    }),
    /reachableAssets/i
  );

  const classification =
    await recordSystemRiskClassification({
      projectId:project.id,
      userId,
      input:{
        systemSnapshotId:first.snapshot.id,
        declaredRiskTier:'medium',
        impactRequiredTier:'medium',
        decision:'aligned',
        maximumCredibleImpact:completeImpact,
        evidenceReferences:[
          'kb004:test:exact-snapshot',
          'kb004:test:bounded-file-authority',
        ],
        rationale:
          'Human review determined the declared tier is not below the observed maximum credible impact for this exact snapshot.',
        limitations:
          'Synthetic local test context only; no production claims.',
      },
    });

  assert.equal(classification.decision, 'aligned');
  assert.equal(classification.declaredRiskTier, 'medium');
  assert.equal(classification.impactRequiredTier, 'medium');
  assert.equal(
    classification.systemSnapshotId,
    first.snapshot.id
  );
  assert.equal(
    classification.snapshotDigest,
    first.snapshot.contentDigest
  );
  assert.equal(classification.reviewerId, userId);
  assert.match(
    classification.classificationDigest,
    /^[a-f0-9]{64}$/
  );

  const loaded = await getSystemRiskClassification({
    projectId:project.id,
    userId,
  });

  assert.equal(loaded.id, classification.id);
  assert.equal(loaded.decision, 'aligned');

  const audit = await db.prepare(`
    SELECT action,target_id
    FROM security_audit_log
    WHERE project_id=?
      AND action=
        'control_intelligence.system_risk_classification_recorded'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(project.id);

  assert.equal(audit.target_id, classification.id);

  const second = await createSystemSnapshot({
    projectId:project.id,
    userId,
    input:{
      architecture:{
        summary:'changed bounded local MCP agent',
      },
      tools:[
        {
          name:'local_file_manager',
          authority:'bounded local file read/write',
        },
      ],
      dataSources:[
        {
          name:'approved local test directory',
          classification:'test-data',
        },
      ],
      autonomyLevel:'autonomous',
      source:'kb004-test',
      expectedCurrentSnapshotId:first.snapshot.id,
    },
  });

  assert.notEqual(second.snapshot.id, first.snapshot.id);

  const carriedForward =
    await getSystemRiskClassification({
      projectId:project.id,
      userId,
    });

  assert.equal(
    carriedForward,
    null,
    'A changed system snapshot must not inherit the previous risk classification.'
  );

  const historical =
    await getSystemRiskClassification({
      projectId:project.id,
      userId,
      systemSnapshotId:first.snapshot.id,
    });

  assert.equal(historical.id, classification.id);

  console.log(JSON.stringify({
    control:'ARL-KB-004',
    migration:
      '023_system_risk_classification.sql',
    humanDecisionValidation:'pass',
    incompleteImpactRejected:'pass',
    exactSnapshotBinding:'pass',
    staleClassificationCarryForward:'blocked',
    historicalTraceability:'pass',
    auditTrail:'pass',
  }));

  await db.close();
} finally {
  await reset();
  await admin.end();
}
