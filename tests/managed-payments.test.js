import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('Stripe Checkout explicitly enables Managed Payments', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /managed_payments\[enabled\][^\n]*true/);
});

test('Stripe requests pin a Managed Payments-compatible API version', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
  assert.match(server, /Stripe-Version/);
  assert.match(config, /2026-06-24\.dahlia/);
});
