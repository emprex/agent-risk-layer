import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const homepage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'public', 'pricing.html'), 'utf8');

test('homepage leads with one real agent and a deployment decision', () => {
  assert.match(homepage, /Before your AI agent reaches production/i);
  assert.match(homepage, /Assess one agent free/i);
  assert.match(homepage, /When a customer asks for proof/i);
  assert.match(homepage, /£99 once for the full assessment package/i);
});

test('pricing makes the one-off assessment the primary paid wedge without overclaiming', () => {
  assert.match(pricing, /Free check first\. £99 when you need the complete assessment/i);
  assert.match(pricing, /primary paid step/i);
  assert.match(pricing, /Purchasing does not itself perform a human review|does not itself perform a human review/i);
  assert.match(pricing, /not an accredited certification/i);
});
