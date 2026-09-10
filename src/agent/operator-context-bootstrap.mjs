import { authenticateUser } from '../auth.js';
import { config } from '../config.js';
import { db, id, initialiseDatabase, insertEvent, nowIso } from '../db.js';
import { createSecurityProject } from '../control-plane-core.js';
import { evaluateAssessment, questionnaire } from '../risk-engine.js';
import { createWorkspace, listWorkspaces } from '../workspaces.js';
import {
  authenticateOperatorSessionToken
} from './operator-session-auth.mjs';
import {
  deriveRepositoryIdentity,
  repositoryIdentityForHostedAuthority
} from './repository-identity.mjs';

export {
  deriveRepositoryIdentity,
  repositoryIdentityForHostedAuthority
} from './repository-identity.mjs';

export const OPERATOR_CONTEXT_SCHEMA = 'arl.agent.operator-context.v1';

function bootstrapError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  for (const [key, value] of Object.entries(details)) {
    Object.defineProperty(error, key, {
      value,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return error;
}

function unknownAssessmentAnswers() {
  const answers = {};
  for (const question of questionnaire) {
    const supportsUnknown = question.options?.some(
      (option) => option.value === 'unknown'
    );
    if (!supportsUnknown) {
      throw bootstrapError(
        'ASSESSMENT_BOOTSTRAP_UNKNOWN_UNSUPPORTED',
        `Assessment question ${question.id} has no explicit unknown option.`
      );
    }
    answers[question.id] = 'unknown';
  }
  return answers;
}

async function createUnknownAssessment({ userId, name }) {
  const answers = unknownAssessmentAnswers();
  const agentType = 'AI agent';
  const result = evaluateAssessment(answers, { agentType });
  const assessmentId = id('asm_');
  const accessToken = id('access_');
  const shareToken = id('share_');
  const created = nowIso();

  await db.prepare(`
    INSERT INTO assessments
      (id, user_id, name, agent_type, answers_json, score, risk_band,
       result_json, paid_tier, access_token, share_token, public_enabled,
       scoring_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 0, ?, ?, ?)
  `).run(
    assessmentId,
    userId,
    name,
    agentType,
    JSON.stringify(answers),
    result.score,
    result.riskBand,
    JSON.stringify(result),
    accessToken,
    shareToken,
    config.scoringVersion,
    created,
    created
  );

  await insertEvent('agent_assessment_bootstrapped', userId, {
    assessmentId,
    answerMode: 'explicit_unknown_only',
    questionCount: questionnaire.length
  });

  return { id: assessmentId, answers, result };
}

function safeWorkspaceNames(workspaces) {
  return (Array.isArray(workspaces) ? workspaces : [])
    .map((workspace) => String(workspace?.name || '').trim())
    .filter(Boolean);
}

async function selectWorkspace({ userId, requestedName }) {
  const workspaces = await listWorkspaces(userId);
  const workspaceOptions = safeWorkspaceNames(workspaces);

  if (requestedName) {
    const matches = workspaces.filter(
      (workspace) => workspace.name === requestedName
    );
    if (matches.length !== 1) {
      throw bootstrapError(
        'WORKSPACE_RESOLUTION_REQUIRED',
        'The requested ARL workspace name did not resolve uniquely.',
        { workspaceOptions }
      );
    }
    return matches[0];
  }

  if (workspaces.length === 1) return workspaces[0];

  if (workspaces.length > 1) {
    if (new Set(workspaceOptions).size !== workspaceOptions.length) {
      throw bootstrapError(
        'WORKSPACE_NAMES_NOT_UNIQUE',
        'Two or more ARL workspaces have the same name. Rename one before continuing so ARL does not guess.',
        { workspaceOptions }
      );
    }
    throw bootstrapError(
      'WORKSPACE_RESOLUTION_REQUIRED',
      'More than one ARL workspace is available. Choose which workspace should contain this agent.',
      { workspaceOptions }
    );
  }

  return createWorkspace(userId, 'ARL Agent Workspace');
}

async function findBoundProject({ userId, repositoryIdentityDigest }) {
  const rows = await db.prepare(`
    SELECT p.id,p.workspace_id,p.name,p.environment,p.agent_assessment_id
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    WHERE m.user_id=? AND m.status='active'
      AND p.status!='archived'
      AND p.repository_identity_digest=?
    ORDER BY p.created_at
  `).all(userId, repositoryIdentityDigest);

  if (rows.length > 1) {
    throw bootstrapError(
      'REPOSITORY_CONTEXT_AMBIGUOUS',
      'The repository is bound to more than one active ARL project. Resolve the duplicate binding before continuing.'
    );
  }
  return rows[0] || null;
}

async function resolveAssessment({ project, userId, projectName }) {
  if (project.agent_assessment_id) {
    const assessment = await db.prepare(
      'SELECT id,user_id,answers_json FROM assessments WHERE id=?'
    ).get(project.agent_assessment_id);
    if (!assessment || assessment.user_id !== userId) {
      throw bootstrapError(
        'PROJECT_ASSESSMENT_BINDING_INVALID',
        'The ARL project assessment binding is missing or belongs to a different operator.'
      );
    }
    return { assessment, created: false };
  }

  const created = await createUnknownAssessment({
    userId,
    name: projectName
  });
  const bound = await db.prepare(`
    UPDATE security_projects
    SET agent_assessment_id=?,updated_at=?
    WHERE id=? AND agent_assessment_id IS NULL
  `).run(created.id, nowIso(), project.id);

  if (Number(bound.changes || 0) !== 1) {
    throw bootstrapError(
      'PROJECT_ASSESSMENT_BINDING_CONFLICT',
      'The ARL project assessment binding changed while it was being initialised.'
    );
  }
  return {
    assessment: {
      id: created.id,
      user_id: userId,
      answers_json: JSON.stringify(created.answers)
    },
    created: true
  };
}

async function resolveOperator({ sessionToken, email, password }) {
  const token = String(sessionToken || '').trim();
  if (token) {
    const operator = await authenticateOperatorSessionToken(token);
    if (!operator?.id) {
      throw bootstrapError(
        'OPERATOR_SESSION_INVALID',
        'The ARL operator session is invalid, expired or revoked. Run the ARL operator login again.'
      );
    }
    if (operator.mfaEnabled && !operator.mfaVerified) {
      throw bootstrapError(
        'OPERATOR_MFA_VERIFICATION_REQUIRED',
        'The ARL operator session must be MFA-verified for this account.'
      );
    }
    return operator;
  }

  const operator = await authenticateUser(email, password);
  if (!operator?.id) {
    throw bootstrapError(
      'OPERATOR_AUTHENTICATION_REQUIRED',
      'A valid ARL operator account is required.'
    );
  }
  if (operator.mfaEnabled) {
    throw bootstrapError(
      'OPERATOR_MFA_SESSION_REQUIRED',
      'This ARL operator account has MFA enabled. Use the ARL operator login to create an MFA-verified session instead of password-only CLI authentication.'
    );
  }
  return operator;
}

function assertAuthenticatedOperator(operator) {
  if (!operator?.id) {
    throw bootstrapError(
      'OPERATOR_AUTHENTICATION_REQUIRED',
      'A valid authenticated ARL operator is required.'
    );
  }
  if (operator.emailVerified !== true) {
    throw bootstrapError(
      'OPERATOR_EMAIL_VERIFICATION_REQUIRED',
      'Verify the ARL operator email before starting an operational assessment.'
    );
  }
  if (operator.mfaEnabled && !operator.mfaVerified) {
    throw bootstrapError(
      'OPERATOR_MFA_VERIFICATION_REQUIRED',
      'The ARL operator session must be MFA-verified for this account.'
    );
  }
  return operator;
}

export async function bootstrapAuthenticatedOperatorContext({
  repositoryIdentity,
  operator,
  workspaceName = '',
  environment = 'test'
} = {}) {
  await initialiseDatabase();
  const authenticatedOperator = assertAuthenticatedOperator(operator);
  const identity = repositoryIdentityForHostedAuthority(repositoryIdentity);

  let project = await findBoundProject({
    userId: authenticatedOperator.id,
    repositoryIdentityDigest: identity.digest
  });
  let projectCreated = false;

  if (!project) {
    const workspace = await selectWorkspace({
      userId: authenticatedOperator.id,
      requestedName: String(workspaceName || '').trim()
    });
    const created = await createSecurityProject({
      userId: authenticatedOperator.id,
      workspaceId: workspace.id,
      name: identity.projectName,
      environment
    });
    await db.prepare(`
      UPDATE security_projects
      SET repository_identity_digest=?,repository_identity_source=?,updated_at=?
      WHERE id=?
    `).run(identity.digest, identity.source, nowIso(), created.id);
    project = await findBoundProject({
      userId: authenticatedOperator.id,
      repositoryIdentityDigest: identity.digest
    });
    if (!project) {
      throw bootstrapError(
        'REPOSITORY_CONTEXT_BINDING_FAILED',
        'The new ARL project could not be bound to the repository.'
      );
    }
    projectCreated = true;
    await insertEvent('agent_repository_context_bound', authenticatedOperator.id, {
      projectId: project.id,
      repositoryIdentityDigest: identity.digest,
      repositoryIdentitySource: identity.source
    });
  }

  const assessmentResolution = await resolveAssessment({
    project,
    userId: authenticatedOperator.id,
    projectName: identity.projectName
  });

  return {
    schema: OPERATOR_CONTEXT_SCHEMA,
    available: true,
    internal: {
      userId: authenticatedOperator.id,
      projectId: project.id,
      assessmentId: assessmentResolution.assessment.id
    },
    repository: {
      source: identity.source,
      display: identity.publicIdentity,
      gitRoot: String(repositoryIdentity?.gitRoot || '').trim() || null
    },
    created: {
      project: projectCreated,
      assessment: assessmentResolution.created
    },
    assessmentInitialisation: assessmentResolution.created
      ? 'explicit_unknown_only'
      : 'existing_authoritative_assessment',
    securityDecisionCreated: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function bootstrapOperatorContext({
  repositoryPath,
  sessionToken = '',
  email,
  password,
  workspaceName = '',
  environment = 'test'
} = {}) {
  await initialiseDatabase();
  const operator = await resolveOperator({ sessionToken, email, password });
  const identity = deriveRepositoryIdentity(repositoryPath);

  return bootstrapAuthenticatedOperatorContext({
    repositoryIdentity: identity,
    operator,
    workspaceName,
    environment
  });
}

export function publicOperatorContext(context) {
  if (context?.available !== true) return null;
  return {
    schema: context.schema,
    available: true,
    repository: {
      source: context.repository.source,
      display: context.repository.display
    },
    created: context.created,
    assessmentInitialisation: context.assessmentInitialisation,
    securityDecisionCreated: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
