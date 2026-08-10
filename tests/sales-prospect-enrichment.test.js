import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'migrations', '018_sales_prospect_verified_enrichment.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

const enrichedRecordIds = [
  'ARL-P-000001',
  'ARL-P-000005',
  'ARL-P-000009',
  'ARL-P-000020',
  'ARL-P-000158',
  'ARL-P-000159',
  'ARL-P-000320',
  'ARL-P-000366',
  'ARL-P-000375',
];

const registryUrls = [
  'https://registry.modelcontextprotocol.io/v0/servers?search=ac.inference.sh',
  'https://registry.modelcontextprotocol.io/v0/servers?search=agency.lona',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.adadvisor',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.agenticterminal',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.eevy',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.enginy',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.openhelm',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.radiusos.www',
  'https://registry.modelcontextprotocol.io/v0/servers?search=ai.redditgrow',
];

test('enrichment is evidence-bound, conservative and does not overwrite OOBE', () => {
  for (const id of enrichedRecordIds) assert.match(migration, new RegExp(id));
  for (const url of registryUrls) assert.ok(migration.includes(url), `missing exact registry evidence URL ${url}`);

  assert.doesNotMatch(migration, /ARL-P-000318/); // OOBE was manually corrected by the owner.
  assert.match(migration, /ARL-P-000143/);
  assert.match(migration, /company_name = 'Dinglebear MCP Suite \(publisher ai\.dinglebear\)'/);
  assert.match(migration, /company_name = '\[object Object\]'/);

  assert.match(migration, /p\.source = 'MCP Registry import'/);
  assert.match(migration, /p\.stage = 'research'/);
  assert.match(migration, /p\.notes NOT LIKE '%\[ARL-ENRICHMENT:2026-08-10\]%'/);
  assert.match(migration, /stage = 'research'/);
  assert.match(migration, /estimated_value_pence = 0/);
  assert.match(migration, /not ARL-tested controls|not independently tested by ARL|not an ARL finding/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /stage\s*=\s*'qualified'/i);

  assert.ok(migration.includes('https://inference.sh/docs/agents/adding-tools'));
  assert.ok(migration.includes('https://inference.sh/docs/connectors/mcp-server'));
  assert.ok(!migration.includes('https://inference.sh/docs/connectors/agent-tools'));
});

test('migration applies once to eligible imported research rows in PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_POSTGRES_URL });
  await client.connect();
  const schema = `arl_sales_${process.pid}_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE sales_prospects (
      id text PRIMARY KEY,
      company_name text,
      website text,
      company_size text,
      buyer_name text,
      buyer_role text,
      buyer_linkedin text,
      source text,
      trigger_signal text,
      agent_use_case text,
      tool_access text,
      evidence_json text NOT NULL DEFAULT '[]',
      score integer NOT NULL DEFAULT 0,
      score_reasons_json text NOT NULL DEFAULT '[]',
      stage text NOT NULL DEFAULT 'research',
      estimated_value_pence integer NOT NULL DEFAULT 0,
      next_action text,
      notes text,
      updated_at text
    )`);

    for (const recordId of enrichedRecordIds) {
      await client.query(
        `INSERT INTO sales_prospects (id, company_name, source, evidence_json, stage, estimated_value_pence, notes, updated_at)
         VALUES ($1,$2,'MCP Registry import','["original-source"]','research',0,$3,'2026-07-28T00:00:00.000Z')`,
        [`lead_${recordId}`, `Original ${recordId}`, `[ARL-IMPORT:${recordId}]\nTechnical candidate — commercial identity unverified.`],
      );
    }

    await client.query(
      `INSERT INTO sales_prospects (id, company_name, source, evidence_json, stage, estimated_value_pence, notes, updated_at)
       VALUES ('lead_bad','[object Object]','MCP Registry import','[]','research',0,'[ARL-IMPORT:ARL-P-000143]','2026-07-28T00:00:00.000Z')`,
    );
    await client.query(
      `INSERT INTO sales_prospects (id, company_name, source, evidence_json, stage, estimated_value_pence, notes, updated_at)
       VALUES ('lead_oobe','OOBE PROTOCOL','MCP Registry import + public-source verification','[]','qualified',9900,'[ARL-IMPORT:ARL-P-000318]\nOwner corrected','2026-08-10T11:00:00.000Z')`,
    );

    await client.query(migration);

    const { rows } = await client.query(`SELECT * FROM sales_prospects ORDER BY id`);
    const enriched = rows.filter((row) => row.source === 'MCP Registry import + public-source verification' && row.id !== 'lead_oobe');
    assert.equal(enriched.length, enrichedRecordIds.length);
    for (const row of enriched) {
      assert.equal(row.stage, 'research');
      assert.equal(row.estimated_value_pence, 0);
      assert.match(row.notes, /\[ARL-ENRICHMENT:2026-08-10\]/);
      assert.ok(JSON.parse(row.evidence_json).includes('original-source'));
      assert.ok([90, 100].includes(row.score));
      assert.notEqual(row.buyer_name, null);
      assert.notEqual(row.buyer_role, null);
    }

    const malformed = rows.find((row) => row.id === 'lead_bad');
    assert.equal(malformed.company_name, 'Dinglebear MCP Suite (publisher ai.dinglebear)');
    assert.match(malformed.notes, /ARL-DATA-CORRECTION:2026-08-10/);

    const oobe = rows.find((row) => row.id === 'lead_oobe');
    assert.equal(oobe.company_name, 'OOBE PROTOCOL');
    assert.equal(oobe.stage, 'qualified');
    assert.equal(oobe.estimated_value_pence, 9900);
    assert.equal(oobe.notes.includes('ARL-ENRICHMENT:2026-08-10'), false);

    const beforeSecondRun = JSON.stringify(rows);
    await client.query(migration);
    const afterSecondRun = JSON.stringify((await client.query(`SELECT * FROM sales_prospects ORDER BY id`)).rows);
    assert.equal(afterSecondRun, beforeSecondRun);
  } finally {
    await client.query('RESET search_path').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await client.end();
  }
});
