import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(
  fs.readFileSync(
    path.join(root, 'ARL_COMPONENT_INVENTORY.json'),
    'utf8'
  )
);
const toolchain = JSON.parse(
  fs.readFileSync(
    path.join(root, 'ARL_TOOLCHAIN_VERSIONS.json'),
    'utf8'
  )
);

test('component inventory describes one canonical ARL repository', () => {
  assert.equal(
    inventory.schema,
    'arl.component-inventory.v2'
  );
  assert.deepEqual(
    inventory.scope.repositories,
    ['emprex/agent-risk-layer']
  );
  assert.equal(
    JSON.stringify(inventory).includes('arl-agent-ai'),
    false
  );
  assert.ok(
    Number(inventory.exactCounts.repositoryFiles) > 0
  );

  const ids =
    inventory.components.map(
      (component) => component.id
    );
  assert.equal(
    new Set(ids).size,
    ids.length,
    'component IDs must be unique'
  );

  for (const component of inventory.components) {
    for (const key of [
      'id',
      'name',
      'purpose',
      'canonicalRepository',
      'canonicalPath',
      'classification',
      'kind',
      'currentVersion'
    ]) {
      assert.ok(
        component[key],
        `${component.id} missing ${key}`
      );
    }

    assert.equal(
      component.canonicalRepository,
      'emprex/agent-risk-layer'
    );
    assert.equal(
      fs.existsSync(
        path.join(root, component.canonicalPath)
      ),
      true,
      `${component.canonicalPath} must exist`
    );
  }
});

test('inventory versions follow the canonical toolchain manifest', () => {
  const byId = new Map(
    inventory.components.map(
      (component) => [
        component.id,
        component
      ]
    )
  );

  assert.equal(
    byId.get('ARL-COMP-001').currentVersion,
    toolchain.product.version
  );
  assert.equal(
    byId.get('ARL-COMP-005').currentVersion,
    toolchain.controlCatalog.version
  );
  assert.equal(
    byId.get('ARL-COMP-006').currentVersion,
    toolchain.inspector.version
  );
  assert.equal(
    byId.get('ARL-COMP-007').currentVersion,
    toolchain.redTeam.version
  );
  assert.equal(
    byId.get('ARL-COMP-008').currentVersion,
    toolchain.runtime.version
  );
});


test('dated canonical inventory counts a fixed non-truncated Git tree, not an invented live total', () => {
  assert.equal(inventory.generatedAt, '2026-10-10');
  assert.equal(inventory.snapshot.completeTree,true);
  assert.match(inventory.snapshot.sourceRevision,/^[a-f0-9]{40}$/);
  assert.match(inventory.snapshot.gitTreeSha,/^[a-f0-9]{40}$/);
  assert.equal(inventory.snapshot.countedObjects,
    'tracked Git blobs (all paths, including archived evidence and tests)');
  assert.equal(inventory.exactCounts.repositoryFiles,859);
  const distribution=inventory.snapshot.approximateTopLevelDistribution;
  assert.ok(Object.values(distribution).every(n=>Number.isSafeInteger(n)&&n>0));
  assert.ok(Object.values(distribution).reduce((a,b)=>a+b,0)<=inventory.exactCounts.repositoryFiles);
});

test('active public intake is the static site, never the legacy hosted-request API',()=>{
  const publicComponent=inventory.components.find(c=>c.id==='ARL-COMP-010');
  const deployment=inventory.activeArchitecture.publicDeployment;
  assert.equal(publicComponent.canonicalPath,'site/index.html');
  assert.equal(deployment.root,'site');
  assert.equal(deployment.entrypoint,'site/index.html');
  assert.equal(deployment.requestHandler,'site/request.js');
  assert.equal(deployment.kind,'static-site');
  assert.equal(deployment.hostedProductDatabase,false);
  assert.equal(deployment.hostedOperator,false);
  assert.match(fs.readFileSync(path.join(root,deployment.entrypoint),'utf8'),
    /action="https:\/\/formspree\.io\/f\//);
  assert.doesNotMatch(fs.readFileSync(path.join(root,deployment.requestHandler),'utf8'),
    /\/api\/assessment-request/);
  for (const entry of inventory.reviewCandidates) {
    assert.ok(fs.existsSync(path.join(root,entry.path)),
      'Deferred legacy candidate is still present for review: '+entry.path);
    assert.match(entry.disposition,/retain|do not remove/i);
  }
  assert.deepEqual(new Set(inventory.reviewCandidates.map(e=>e.path)).size,3);
});

test('active Operator inventory binds local PostgreSQL authority and no extra backend',()=>{
  const assessment=inventory.activeArchitecture.assessment;
  assert.equal(assessment.kind,'local-human-led');
  assert.equal(assessment.runner,'src/agent/arl-local-assessment-runner.mjs');
  assert.equal(assessment.cli,'bin/arl-operator.mjs');
  assert.equal(assessment.database,'src/db.js');
  assert.match(assessment.persistence,/PostgreSQL/);
  assert.equal(assessment.sqlite,'test-only');
  assert.match(inventory.activeArchitecture.humanAuthority,/never final applicability/);
  assert.match(fs.readFileSync(path.join(root,assessment.database),'utf8'),
    /DATABASE_URL is required/);
});
