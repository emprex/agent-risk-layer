import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'ARL_COMPONENT_INVENTORY.json'), 'utf8'));
const toolchain = JSON.parse(fs.readFileSync(path.join(root, 'ARL_TOOLCHAIN_VERSIONS.json'), 'utf8'));

test('component inventory is structurally complete for its recorded snapshot', () => {
  assert.equal(inventory.schema, 'arl.component-inventory.v1');
  assert.equal(inventory.authorityRule, 'The LLM is not the security authority.');
  assert.equal(inventory.exactCounts.productFiles, inventory.repositoryFiles['emprex/agent-risk-layer'].length);
  assert.equal(inventory.exactCounts.operatorFiles, inventory.repositoryFiles['emprex/arl-agent-ai'].length);
  assert.equal(
    inventory.exactCounts.repositoryFilesTotal,
    inventory.exactCounts.productFiles + inventory.exactCounts.operatorFiles
  );
  assert.equal(inventory.exactCounts.normalizedComponentGroups, inventory.components.length);

  const ids = inventory.components.map((component) => component.id);
  assert.equal(new Set(ids).size, ids.length, 'component IDs must be unique');

  for (const component of inventory.components) {
    for (const key of ['id', 'name', 'purpose', 'canonicalRepository', 'canonicalPath', 'classification', 'kind']) {
      assert.ok(component[key], `${component.id} missing ${key}`);
    }
  }
});

test('inventory versions follow the canonical toolchain manifest', () => {
  const byId = new Map(inventory.components.map((component) => [component.id, component]));
  assert.equal(byId.get('ARL-COMP-001').currentVersion, toolchain.product.version);
  assert.equal(byId.get('ARL-COMP-017').currentVersion, toolchain.inspector.version);
  assert.equal(byId.get('ARL-COMP-020').currentVersion, toolchain.redTeam.version);
  assert.equal(byId.get('ARL-COMP-024').currentVersion, toolchain.runtime.version);
  assert.equal(byId.get('ARL-COMP-028').currentVersion, toolchain.operator.version);
  assert.equal(byId.get('ARL-COMP-044').currentVersion, toolchain.schema);
  assert.equal(byId.get('ARL-COMP-049').currentVersion, toolchain.platform.pg);
});
