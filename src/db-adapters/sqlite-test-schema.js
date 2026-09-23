async function ensureSqliteColumn(db, tableName, columnName, definition) {
  if (!/^[a-z0-9_]+$/i.test(tableName) || !/^[a-z0-9_]+$/i.test(columnName)) {
    throw new Error('Unsafe SQLite schema identifier.');
  }

  const columns = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => String(column.name) === columnName)) return false;

  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

export async function ensureSqliteTestSchema(db) {
  if (db?.kind !== 'sqlite-test') {
    throw new Error('SQLite test schema bootstrap requires the isolated sqlite-test adapter.');
  }

  // Production migrations are PostgreSQL-only. This additive compatibility
  // schema exists only for isolated tests, including the P4.12 process boundary
  // where bootstrap and hosted server reopen the same SQLite test database.
  await ensureSqliteColumn(
    db,
    'control_evidence_items',
    'redteam_run_id',
    'TEXT REFERENCES redteam_runs(id) ON DELETE SET NULL'
  );
  await ensureSqliteColumn(
    db,
    'control_evidence_items',
    'redteam_baseline_run_id',
    'TEXT REFERENCES redteam_runs(id) ON DELETE SET NULL'
  );
  await ensureSqliteColumn(
    db,
    'control_evidence_items',
    'redteam_case_id',
    'TEXT'
  );

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_control_evidence_redteam_run
      ON control_evidence_items(redteam_run_id, redteam_case_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_control_evidence_redteam_exact_binding
      ON control_evidence_items(test_execution_id, redteam_run_id, redteam_case_id)
      WHERE redteam_run_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS control_evidence_trust_revisions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES control_evidence_items(id) ON DELETE RESTRICT,
      replacement_evidence_id TEXT REFERENCES control_evidence_items(id) ON DELETE SET NULL,
      previous_verification_state TEXT NOT NULL,
      new_verification_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      previous_descriptor_json TEXT NOT NULL,
      previous_integrity_digest TEXT NOT NULL CHECK (length(previous_integrity_digest)=64),
      revision_digest TEXT NOT NULL CHECK (length(revision_digest)=64),
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(evidence_id,replacement_evidence_id,new_verification_state)
    );
    CREATE INDEX IF NOT EXISTS idx_control_evidence_trust_revision_scope
      ON control_evidence_trust_revisions(workspace_id,project_id,evidence_id,created_at DESC);
  `);

  await ensureSqliteColumn(
    db,
    'security_projects',
    'repository_identity_digest',
    'TEXT'
  );
  await ensureSqliteColumn(
    db,
    'security_projects',
    'repository_identity_source',
    'TEXT'
  );
  await ensureSqliteColumn(
    db,
    'security_projects',
    'agent_assessment_id',
    'TEXT'
  );

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_projects_repository_identity_active
      ON security_projects(workspace_id, repository_identity_digest)
      WHERE repository_identity_digest IS NOT NULL AND status != 'archived';
    CREATE INDEX IF NOT EXISTS idx_security_projects_agent_assessment
      ON security_projects(agent_assessment_id)
      WHERE agent_assessment_id IS NOT NULL;
  `);
}
