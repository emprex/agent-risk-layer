import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  boundedSearch, noteInput, requireTicketId, verifiedMaster
} from '../desktop/enkyron-contract.mjs';

const id = '11111111-2222-4333-8444-555555555555';

test('ENKYRON ticket lookup uses strict identifiers', () => {
  assert.equal(requireTicketId(id), id);
  for (const bad of ['', 'abc', "1' OR 1=1", id.toUpperCase()]) {
    assert.throws(() => requireTicketId(bad), /Invalid ticket/);
  }
});

test('ENKYRON search and notes reject oversized or malformed input', () => {
  assert.equal(boundedSearch('  MCP server  '), 'MCP server');
  assert.throws(() => boundedSearch('a'.repeat(101)), /100 characters/);
  assert.deepEqual(noteInput({ ticket_id: id, body: '  Reviewed scope  ' }), {
    ticketId: id, body: 'Reviewed scope'
  });
  for (const body of ['', ' \n ', 'x'.repeat(12001)]) {
    assert.throws(() => noteInput({ ticket_id: id, body }), /Note must/);
  }
});

test('ENKYRON rejects master tampering and cross-snapshot linkage', () => {
  const body = '# Recorded master\nHistorical note';
  const digest = createHash('sha256').update(body).digest('hex');
  const master = {
    project_id: 'prj_demo',
    assessment_id: 'asm_demo',
    snapshot_project_id: 'prj_demo',
    target_sha: '123abc',
    document_md: body,
    document_sha256: digest,
    assessment_configuration_json: {
      assessmentBinding: { assessmentId: 'asm_demo' },
      targetBinding: { revision: '123abc' }
    }
  };
  assert.equal(verifiedMaster(master, 'prj_demo', 'asm_demo').integrity, 'verified');
  assert.throws(() => verifiedMaster({ ...master, document_md: body + 'changed' }, 'prj_demo', 'asm_demo'), /SHA-256/);
  assert.throws(() => verifiedMaster({ ...master, snapshot_project_id: 'another' }, 'prj_demo', 'asm_demo'), /identity mismatch/);
  assert.throws(() => verifiedMaster({
    ...master, assessment_configuration_json: {
      assessmentBinding: { assessmentId: 'asm_demo' },
      targetBinding: { revision: 'another_sha' }
    }
  }, 'prj_demo', 'asm_demo'), /binding mismatch/);
});

test('ENKYRON native UI compiles as Python without starting Qt', t => {
  const python = spawnSync('python3', ['-c',
    'import ast, pathlib; ast.parse(pathlib.Path("desktop/enkyron.py").read_text(encoding="utf-8"))'
  ], { encoding: 'utf8' });
  if (python.error?.code === 'ENOENT') return t.skip('Python unavailable');
  assert.equal(python.status, 0, python.stderr);
  const source = readFileSync('desktop/enkyron.py', 'utf8');
  assert.match(source, /class EnkyronWindow\(QMainWindow\)/);
  assert.doesNotMatch(source, /QWebEngine|QWebView|http:\/\/127\.0\.0\.1/);
});
