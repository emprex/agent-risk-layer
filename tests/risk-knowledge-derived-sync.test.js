import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const canonical = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const publicAsset = JSON.parse(fs.readFileSync(new URL('../public/risk-knowledge-public-v1.1.json', import.meta.url), 'utf8'));
const sql = fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.sql', import.meta.url), 'utf8');

test('all 108 public risk knowledge entries track the exact canonical signatures', () => {
  assert.equal(canonical.entries.length, 108);
  assert.equal(publicAsset.entries.length, canonical.entries.length);
  const byId = new Map(publicAsset.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.size, canonical.entries.length);
  for (const entry of canonical.entries) {
    const published = byId.get(entry.id);
    assert.ok(published, 'public entry missing: ' + entry.id);
    assert.equal(published.content_digest, entry.content_digest, 'stale public knowledge: ' + entry.id);
    assert.deepEqual(published.problem, entry.problem, 'stale public problem: ' + entry.id);
    assert.deepEqual(published.review, entry.review, 'stale public review: ' + entry.id);
  }
});

test('generated current-state SQL entry digests track the canonical source', () => {
  const entryUpdates = sql.split('\n').filter((line) =>
    line.startsWith('UPDATE risk_knowledge_entries SET '));
  assert.equal(entryUpdates.length, canonical.entries.length);
  for (const entry of canonical.entries) {
    const line = entryUpdates.find((text) => text.endsWith("WHERE id='" + entry.id + "';"));
    assert.ok(line, 'SQL entry missing: ' + entry.id);
    assert.ok(line.includes("content_digest='" + entry.content_digest + "'"), 'stale SQL digest: ' + entry.id);
  }
});
