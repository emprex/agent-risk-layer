import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { localCliDatabasePath } from './local-cli-mode.mjs';
import { db, id, nowIso, initialiseDatabase } from '../db.js';
import { createWorkspace } from '../workspaces.js';
import { createSecurityProject } from '../control-plane-core.js';
import { createUnknownAssessment } from './operator-context-bootstrap.mjs';

export async function resolveLocalAssessmentContext(repositoryPath) {
  if (!localCliDatabasePath() || db.kind !== 'sqlite-test') throw new Error('Local CLI persistence is required.');
  await initialiseDatabase();
  const root = fs.realpathSync(repositoryPath);
  const digest = crypto.createHash('sha256').update(root).digest('hex');
  // A per-repository local principal has no usable password or hosted session.
  // IDs are real persisted records, resolved by canonical repository path.
  const email = `${digest}@local.invalid`;
  return db.transaction(async () => {
    let user = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (user) {
      const project = await db.prepare('SELECT id,agent_assessment_id FROM security_projects WHERE created_by=? AND repository_identity_digest=?').get(user.id, digest);
      if (!project?.agent_assessment_id) throw new Error('Local assessment binding is incomplete.');
      return { userId: user.id, projectId: project.id, assessmentId: project.agent_assessment_id };
    }
    user = { id: id('usr_') };
    await db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(user.id, email, 'local-login-disabled', nowIso());
    const workspace = await createWorkspace(user.id, `Local assessment: ${os.userInfo().username}`);
    const project = await createSecurityProject({ userId: user.id, workspaceId: workspace.id, name: root.split('/').pop(), environment: 'test' });
    const assessment = await createUnknownAssessment({ userId: user.id, name: project.name });
    await db.prepare('UPDATE security_projects SET repository_identity_digest=?,repository_identity_source=?,agent_assessment_id=? WHERE id=?').run(digest, 'local_path', assessment.id, project.id);
    return { userId: user.id, projectId: project.id, assessmentId: assessment.id };
  });
}
