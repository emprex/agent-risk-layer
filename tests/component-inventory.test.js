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
