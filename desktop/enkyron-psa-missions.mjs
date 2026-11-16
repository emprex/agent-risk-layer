// ENK-08: local planning-only mission persistence. No contract or security authority.
// Actor is supplied by a TRUSTED local bridge (OS account), never by IPC JSON.
// This is NOT an authenticated multi-tenant RBAC system. Do not connect remotely.
import {createHash, randomUUID} from 'node:crypto';
import {validateMissionPlanCreate} from './enkyron-psa-planning-contract.mjs';
import {psaLocalScope, psaUuid, psaTransaction} from './enkyron-psa-db.mjs';

function digest(data) {
  return createHash('sha256').update(JSON.stringify([
    data.company_id, data.opportunity_id, data.title,
    data.description, data.due_date, 'planning',
  ])).digest('hex');
}

function resultFor(row, contentSha, created) {
  if (!row || row.content_sha256.trim() !== contentSha || row.status !== 'planning') {
    throw new Error('PSA request ID reused for a different mission or state');
  }
  return {
    id: row.id, company_id: row.company_id,
    opportunity_id: row.opportunity_id,
    status: 'planning', version: row.version,
    created,
    notice: 'Internal mission planning only. No contract acceptance or security test authority.',
  };
}

/**
 * Create a planning mission or return the same mission on an identical retry.
 * All writes + append-only audit event commit atomically. No external side effects.
 * options.uuid is for deterministic isolated tests only, not caller-facing IPC.
 */
export async function createMissionPlan(pool, input, actor, options = {}) {
  const data = validateMissionPlanCreate(input);
  const owner = psaLocalScope(actor);
  const contentSha = digest(data);
  const generateId = options.uuid ?? randomUUID;
  return psaTransaction(pool, async client => {
    const existing = (await client.query(
      'SELECT id,company_id,opportunity_id,status,version,content_sha256 '
      + 'FROM enkyron_psa_missions WHERE workspace_key=$1 AND request_id=$2 FOR KEY SHARE',
      [owner.workspace, data.request_id]
    )).rows[0];
    if (existing) return resultFor(existing, contentSha, false);

    // Reject non-existent or cross-workspace company, not a name-based match.
    const company = (await client.query(
      'SELECT id FROM enkyron_crm_companies '
      + 'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.workspace, data.company_id]
    )).rows[0];
    if (!company) throw new Error('PSA company not found in local workspace');

    if (data.opportunity_id) {
      // v1 only accepts an opportunity directly linked to the same CRM company.
      // Legacy prospect-only opportunities need separate reviewed association.
      const opportunity = (await client.query(
        'SELECT company_id FROM enkyron_crm_opportunities '
        + 'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
        [owner.workspace, data.opportunity_id]
      )).rows[0];
      if (!opportunity || opportunity.company_id !== data.company_id) {
        throw new Error('PSA opportunity is not linked to the selected company');
      }
    }

    const missionId = psaUuid(generateId(), 'generated mission ID');
    const inserted = (await client.query(
      'INSERT INTO enkyron_psa_missions '
      + '(id,workspace_key,company_id,opportunity_id,title,description,due_date,'
      + 'request_id,content_sha256,created_by) '
      + 'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '
      + 'ON CONFLICT (workspace_key,request_id) DO NOTHING '
      + 'RETURNING id,company_id,opportunity_id,status,version,content_sha256',
      [missionId, owner.workspace, data.company_id, data.opportunity_id,
        data.title, data.description, data.due_date,
        data.request_id, contentSha, owner.actor]
    )).rows[0];

    if (!inserted) {
      // Concurrent identical request won. READ COMMITTED sees it after conflict wait.
      const winner = (await client.query(
        'SELECT id,company_id,opportunity_id,status,version,content_sha256 '
        + 'FROM enkyron_psa_missions WHERE workspace_key=$1 AND request_id=$2 FOR KEY SHARE',
        [owner.workspace, data.request_id]
      )).rows[0];
      return resultFor(winner, contentSha, false);
    }

    const eventId = psaUuid(generateId(), 'generated audit event ID');
    await client.query(
      'INSERT INTO enkyron_psa_mission_events '
      + '(id,workspace_key,mission_id,version,event_type,request_id,content_sha256,actor_local) '
      + "VALUES($1,$2,$3,1,'created',$4,$5,$6)",
      [eventId, owner.workspace, missionId, data.request_id, contentSha, owner.actor]
    );
    return resultFor(inserted, contentSha, true);
  });
}

/** Non-mutating operator-scoped list for future Mission Board. */
export async function listMissionPlans(pool, actor, companyId = null) {
  const owner = psaLocalScope(actor);
  const company = companyId == null ? null : psaUuid(companyId, 'company ID');
  const response = await pool.query(
    'SELECT m.id,m.company_id,c.name AS company_name,m.opportunity_id,'
    + 'm.title,m.description,m.due_date::text AS due_date,m.status,m.version,m.created_at '
    + 'FROM enkyron_psa_missions m '
    + 'JOIN enkyron_crm_companies c ON c.workspace_key=m.workspace_key AND c.id=m.company_id '
    + 'WHERE m.workspace_key=$1 AND ($2::text IS NULL OR m.company_id=$2) '
    + 'ORDER BY m.created_at DESC,m.id DESC LIMIT 51',
    [owner.workspace, company]
  );
  return {items: response.rows.slice(0, 50), more: response.rows.length > 50};
}

/**
 * The canonical desktop Mission Board reader. This never creates tables,
 * guesses missions from CRM companies, changes data or grants authorisation.
 * One operator-scoped read returns the existing PSA records and their children.
 */
export async function readMissionBoard(pool, actor) {
  const owner = psaLocalScope(actor);
  const tables = [
    'enkyron_psa_missions', 'enkyron_psa_work_items',
    'enkyron_psa_time_entries',
  ];
  const check = await pool.query(
    "SELECT to_regclass('public.enkyron_psa_missions') AS missions,"
    + "to_regclass('public.enkyron_psa_work_items') AS work_items,"
    + "to_regclass('public.enkyron_psa_time_entries') AS time_entries"
  );
  if (!check.rows[0]?.missions || !check.rows[0]?.work_items ||
      !check.rows[0]?.time_entries) {
    return {
      available: false, items: [], more: false, can_write: false,
      notice: 'Mission Board tables not installed. CRM companies can be viewed separately.',
    };
  }
  const missions = await listMissionPlans(pool, owner.actor);
  const items = [];
  for (const mission of missions.items) {
    const workItems = (await pool.query(
      'SELECT id,mission_id,kind,title,due_date::text AS due_date,status,version '
      + 'FROM enkyron_psa_work_items '
      + 'WHERE workspace_key=$1 AND mission_id=$2 '
      + 'ORDER BY created_at ASC,id ASC LIMIT 101',
      [owner.workspace, mission.id]
    )).rows;
    const timeEntries = (await pool.query(
      'SELECT id,mission_id,work_item_id,work_date::text AS work_date,'
      + 'minutes,note,status,billing_state FROM enkyron_psa_time_entries '
      + 'WHERE workspace_key=$1 AND mission_id=$2 '
      + 'ORDER BY work_date DESC,created_at DESC,id DESC LIMIT 51',
      [owner.workspace, mission.id]
    )).rows;
    if (workItems.length > 100 || timeEntries.length > 50) {
      return {available: false, items: [], more: true, can_write: false,
        notice: 'Mission contains more entries than the bounded desktop viewer supports.'};
    }
    items.push({...mission, work_items: workItems, time_entries: timeEntries});
  }
  return {
    available: true, items, more: missions.more, can_write: false,
    notice: 'Existing internal planning missions (read only). Contract and testing approval are separate.',
  };
}
