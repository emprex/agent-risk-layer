import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(
  new URL('../desktop/enkyron-bridge.mjs', import.meta.url),
  'utf8'
);

test('Mail CRM link has write permission in the bridge', () => {
  const section = source.match(
    /const readOnly\s*=\s*!\[([\s\S]*?)\]\.includes\(command\);/
  );
  assert.ok(section, 'Writable operation list must exist');

  const commands = [...section[1].matchAll(/'([^']+)'/g)]
    .map(match => match[1]);

  assert.equal(
    commands.filter(name => name === 'mail-local-company-link').length,
    1
  );
  assert.ok(commands.includes('mail-local-ticket-link'));
});

test('Mail CRM link remains dispatched to the existing service', () => {
  assert.match(
    source,
    /command\s*===\s*'mail-local-company-link'\s*\?\s*await\s+linkLocalMailCompany\(/
  );
});
