// ENKYRON ticket -> canonical local ARL assessment onboarding.
// Explicit human-selected local Git target. Reuses ARL's existing bootstrap;
// no new assessment database, no active tests and no implicit authority.
import crypto, {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, execFile as childExecFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFile = promisify(childExecFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;

function invalid(message) { throw new Error('Local assessment ' + message); }

export function validateAssessmentSelection(input, confirmed = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.ticket_id !== 'string' || !UUID.test(input.ticket_id) ||
      typeof input.repository_path !== 'string' ||
      input.repository_path.length > 1024 ||
      !path.isAbsolute(input.repository_path) ||
      /[\u0000-\u001f\u007f]/u.test(input.repository_path)) {
    invalid('requires a ticket and an absolute local Git folder');
  }
  if (confirmed && (input.confirmed !== true ||
      typeof input.expected_sha !== 'string' || !SHA.test(input.expected_sha))) {
    invalid('requires explicit confirmation and an exact Git commit SHA');
  }
  return {ticketId: input.ticket_id, requestedPath: input.repository_path,
    expectedSha: input.expected_sha || null};
}

export function frozenLocalTarget(requestedPath, options = {}) {
  let root;
  try { root = fs.realpathSync(requestedPath); }
  catch { invalid('target folder is not available'); }
  // Never inspect system paths or the ARL product repository as assessment targets.
  const home = fs.realpathSync(os.homedir());
  if (!root.startsWith(home + path.sep) || root === REPO_ROOT) {
    invalid('target must be a separate repository under the local home folder');
  }
  if (!fs.statSync(root).isDirectory()) invalid('target must be a directory');
  const git = (args) => execFileSync('git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args],
    {encoding:'utf8', timeout:8000, maxBuffer:250000}).trim();
  let sha, dirty;
  try {
    sha = git(['rev-parse', '--verify', 'HEAD']);
    const top = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
    if (top !== root) invalid('select the repository root folder');
    dirty = git(['status', '--porcelain', '--untracked-files=all']);
  } catch (error) {
    if (String(error.message).startsWith('Local assessment ')) throw error;
    invalid('requires an accessible, valid Git repository');
  }
  if (!SHA.test(sha)) invalid('Git commit is not a full SHA');
  if (dirty) invalid('target contains uncommitted or untracked changes');
  const digest = crypto.createHash('sha256').update(root).digest('hex');
  return {repositoryPath:root, sha, digest,
    source:'local_git', clean:true,
    ...(options.includeName ? {name:path.basename(root)} : {})};
}

async function eligibleProject(client, target) {
  const {rows} = await client.query(
    `SELECT p.id,p.name,p.agent_assessment_id
       FROM security_projects p JOIN users u ON u.id=p.created_by
      WHERE p.repository_identity_digest=$1
        AND p.repository_identity_source='local_path'
        AND u.email=$2 LIMIT 3`,
    [target.digest, target.digest+'@local.invalid']);
  if (rows.length > 1) invalid('ambiguous project identity — human review required');
  const project = rows[0];
  if (!project) return null;
  if (!project.agent_assessment_id) invalid('project exists with no linked assessment');
  const snapshots = (await client.query(
    `SELECT id,assessment_configuration_json
       FROM system_snapshots WHERE project_id=$1 AND status='current' LIMIT 3`,
    [project.id])).rows;
  if (snapshots.length !== 1) invalid('requires exactly one current canonical snapshot');
  const snapshot = snapshots[0];
  let config;
  try {
    config = typeof snapshot.assessment_configuration_json === 'string'
      ? JSON.parse(snapshot.assessment_configuration_json)
      : snapshot.assessment_configuration_json;
  } catch { invalid('snapshot configuration cannot be verified'); }
  if (config?.targetBinding?.source !== 'git' ||
      config.targetBinding.revision !== target.sha ||
      config?.assessmentBinding?.assessmentId !== project.agent_assessment_id) {
    invalid('current snapshot is not bound to this exact Git SHA and assessment');
  }
  return {projectId:project.id, projectName:project.name,
    assessmentId:project.agent_assessment_id, snapshotId:snapshot.id};
}

async function ticketEligibility(client, ticketId, actor, lock = false) {
  const {rows} = await client.query(
    `SELECT id,ticket_number,title,status,archived_at,assigned_to,
            linked_project_id,linked_assessment_id
       FROM arl_workbench_tickets WHERE id=$1 ${lock?'FOR UPDATE':''}`,
    [ticketId]);
  const ticket=rows[0];
  if (!ticket) invalid('ticket not found');
  if (ticket.archived_at || ticket.status==='closed') invalid('closed or archived ticket cannot be linked');
  if (ticket.linked_project_id || ticket.linked_assessment_id) {
    invalid('ticket already linked — inspect its current assessment instead');
  }
  if (ticket.assigned_to && ticket.assigned_to !== actor)
    invalid('ticket belongs to another operator');
  return ticket;
}

export async function assessmentPreflight(pool, input, actor) {
  const {ticketId,requestedPath} = validateAssessmentSelection(input);
  const target = frozenLocalTarget(requestedPath,{includeName:true});
  await ticketEligibility(pool,ticketId,actor);
  const project=await eligibleProject(pool,target);
  return {available:true,ticketId,
    target:{path:target.repositoryPath,sha:target.sha,clean:true,name:target.name},
    mode:project?'link_existing':'create_new',
    project,
    notice:project?'Existing canonical assessment found; no duplicate will be created.'
      :'No canonical local assessment for this exact folder; initialisation needs separate confirmation.',
    activeTestsAuthorised:false,securityVerdict:false};
}

async function commitLink(pool, ticketId, actor, target, candidate) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket=await ticketEligibility(client,ticketId,actor,true);
    const current=await eligibleProject(client,target);
    if (!current || current.projectId!==candidate.projectId ||
        current.assessmentId!==candidate.assessmentId ||
        current.snapshotId!==candidate.snapshotId)
      invalid('candidate changed before linking; reopen preflight');
    const claimed=(await client.query(
      'SELECT id FROM arl_workbench_tickets WHERE linked_project_id=$1 AND id<>$2 LIMIT 1',
      [current.projectId,ticketId])).rows;
    if (claimed.length) invalid('assessment is already linked to another ticket');
    await client.query(
      `UPDATE arl_workbench_tickets SET linked_project_id=$1,
         linked_assessment_id=$2,target_kind='git',target_reference=$3,updated_at=NOW()
       WHERE id=$4`,
      [current.projectId,current.assessmentId,target.repositoryPath,ticketId]);
    const auditNote = 'Canonical ARL assessment linked by local operator.\n' +
      'Project: ' + current.projectId + '\n' +
      'Assessment: ' + current.assessmentId + '\n' +
      'Snapshot: ' + current.snapshotId + '\n' +
      'Git target: ' + target.repositoryPath + '\n' +
      'Frozen commit: ' + target.sha + '\n' +
      'Administrative binding only; no test authorisation or finding validation.';
    // Reuse the EXISTING ticket note/event ledger, whose event_type CHECK
    // permits note_added. Do not fabricate a new event enum or run a migration.
    await client.query(
      `INSERT INTO arl_workbench_notes
       (id,ticket_id,body,source_type,entered_by)
       VALUES($1,$2,$3,'manual',$4)`,
      [randomUUID(),ticketId,auditNote,actor]);
    await client.query(
      `INSERT INTO arl_workbench_ticket_events
       (id,ticket_id,event_type,detail,actor)
       VALUES($1,$2,'note_added',$3,$4)`,
      [randomUUID(),ticketId,'Canonical ARL assessment binding recorded as a work note',actor]);
    await client.query('COMMIT');
    return {linked:true,ticketNumber:ticket.ticket_number,
      projectId:current.projectId,assessmentId:current.assessmentId,
      snapshotId:current.snapshotId,targetSha:target.sha,
      notice:'Assessment linked. Master dossier remains unavailable until separately recorded and verified. No tests authorised.'};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}

export async function linkOrCreateTicketAssessment(pool, input, actor) {
  const {ticketId,requestedPath,expectedSha}=validateAssessmentSelection(input,true);
  const target=frozenLocalTarget(requestedPath);
  if(target.sha!==expectedSha) invalid('target SHA changed since human confirmation');
  await ticketEligibility(pool,ticketId,actor);
  let candidate=await eligibleProject(pool,target);
  const wanted=input.operation;
  if (!['link_existing','create_new'].includes(wanted)) invalid('operation must be explicit');
  if (wanted==='link_existing' && !candidate) invalid('no existing assessment to link');
  if (wanted==='create_new' && candidate) invalid('assessment already exists; link it instead');
  if (!candidate) {
    try {
      await execFile(process.execPath,
        [path.join(REPO_ROOT,'src/agent/arl-local-assessment-runner.mjs'),
          target.repositoryPath,'show assessment context'],
        {cwd:REPO_ROOT,timeout:80000,maxBuffer:2*1024*1024,
          env:{...process.env,ARL_EXPECTED_TARGET_SHA:expectedSha,ARL_AI_ADVISORY:'0'}});
    } catch {
      invalid('canonical creation failed or timed out; no ticket link was recorded. Inspect existing state before retrying');
    }
    // Never take the CLI text as authority; verify the actual PostgreSQL
    // project, current snapshot and exact Git binding before any ticket write.
    candidate=await eligibleProject(pool,frozenLocalTarget(requestedPath));
    if (!candidate) invalid('canonical creation did not produce a verifiable local assessment');
  }
  return commitLink(pool,ticketId,actor,frozenLocalTarget(requestedPath),candidate);
}
