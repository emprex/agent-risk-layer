import test from 'node:test';
import assert from 'node:assert/strict';
import { listSalesProspects } from '../desktop/enkyron-crm-prospects.mjs';

test('legacy CRM prospects are bounded and read only', async () => {
  const calls = [];
  const rows = Array.from({ length: 101 }, (_, i) => ({
    id: 'ARL-P-' + String(i).padStart(6, '0'),
    company_name: 'Company ' + i, buyer_name: null,
    stage: 'research', source: 'MCP Registry import'
  }));
  const pool = { query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows };
  }};
  const result = await listSalesProspects(pool, '  Example  ');
  assert.equal(result.available, true);
  assert.equal(result.kind, 'unverified_sales_prospects');
  assert.equal(result.items.length, 100);
  assert.equal(result.more, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^SELECT /);
  assert.match(calls[0].sql, /LIMIT 101/);
  assert.deepEqual(calls[0].values, ['Example']);
  assert.doesNotMatch(calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s/i);
});

test('prospect lookup preserves literal search and rejects oversized input', async () => {
  let seen = null;
  const pool = { query: async (_sql, values) => {
    seen = values;
    return { rows: [] };
  }};
  const candidate = "O'Reilly_%";
  assert.equal((await listSalesProspects(pool, candidate)).items.length, 0);
  assert.deepEqual(seen, [candidate]);
  await assert.rejects(() => listSalesProspects(pool, 'x'.repeat(101)), /100 characters/);
});

test('uninstalled legacy prospect table is explicit and non-destructive', async () => {
  const result = await listSalesProspects({
    query: async () => { const e = new Error('missing'); e.code = '42P01'; throw e; }
  }, '');
  assert.equal(result.available, false);
  assert.deepEqual(result.items, []);
  assert.match(result.notice, /not installed/);
  await assert.rejects(
    () => listSalesProspects({query: async () => {throw new Error('access denied');}}, ''),
    /access denied/
  );
});
