import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  normaliseHostedOperatorContextInput
} from '../src/agent/hosted-operator-context.mjs';

const root = path.resolve(import.meta.dirname, '..');

const repositoryIdentity = {
  digest: 'a'.repeat(64),
  source: 'git_remote',
  projectName: 'agentic mcp client',
  publicIdentity:
    'github.com/peakmojo/agentic-mcp-client'
};

test('hosted operator context carries a normalized commercial assessment reference', () => {
  const first =
    normaliseHostedOperatorContextInput({
      repositoryIdentity,
      environment: 'staging',
      assessmentReference:
        ' arl-255001a7086b '
    });

  const second =
    normaliseHostedOperatorContextInput({
      repositoryIdentity,
      environment: 'staging',
      assessmentReference:
        'ARL-OTHER-CUSTOMER'
    });

  assert.equal(
    first.assessmentReference,
    'ARL-255001A7086B'
  );
  assert.equal(
    second.assessmentReference,
    'ARL-OTHER-CUSTOMER'
  );
  assert.notEqual(
    first.assessmentReference,
    second.assessmentReference
  );
});

test('assessment-case repository binding includes the commercial reference', () => {
  const bootstrap = fs.readFileSync(
    path.join(
      root,
      'src/agent/operator-context-bootstrap.mjs'
    ),
    'utf8'
  );
  const migration = fs.readFileSync(
    path.join(
      root,
      'migrations/022_agent_assessment_case_reference.sql'
    ),
    'utf8'
  );

  assert.match(
    bootstrap,
    /p\.agent_assessment_reference=\?/
  );
  assert.match(
    bootstrap,
    /agent_assessment_reference=\?,updated_at=\?/
  );
  assert.match(
    bootstrap,
    /assessmentReference:\s*caseReference/
  );

  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS agent_assessment_reference TEXT/
  );
  assert.match(
    migration,
    /COALESCE\(agent_assessment_reference, ''\)/
  );
  assert.match(
    migration,
    /DROP INDEX IF EXISTS idx_security_projects_repository_identity_active/
  );
});

test('legacy callers without an assessment reference retain isolated legacy binding semantics', () => {
  const normalized =
    normaliseHostedOperatorContextInput({
      repositoryIdentity,
      environment: 'test'
    });

  assert.equal(
    normalized.assessmentReference,
    null
  );
});
