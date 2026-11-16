// ENK-08: manual time log, draft and non-billable by construction.
// Unconnected service. Actor MUST come from the trusted local OS bridge,
// not a request payload. No authenticated multi-user RBAC exists yet.
import {createHash, randomUUID} from 'node:crypto';
import {validateMissionTimeEntryCreate} from './enkyron-psa-planning-contract.mjs';
import {psaLocalScope, psaUuid, psaTransaction} from './enkyron-psa-db.mjs';

const digest = d => createHash('sha256').update(JSON.stringify([
  d.mission_id, d.work_item_id, d.work_date, d.minutes, d.note,
  'draft', 'not_billable'
])).digest('hex');

function sameRequest(row, sha, created) {
  if (!row || row.content_sha256.trim() !== sha ||
      row.status !== 'draft' || row.billing_state !== 'not_billable') {
    throw new Error('PSA time request ID reused for different content or state');
  }
  return {
    id: row.id, mission_id: row.mission_id,
    work_item_id: row.work_item_id, work_date: row.work_date,
    minutes: row.minutes, status: 'draft', billing_state: 'not_billable',
    created, notice: 'Internal draft only. Not billable, approved, or a payroll record.',
  };
}

/** Manual time entry: atomic insertion plus immutable event, idempotent retry. */
export async function createMissionTimeEntry(pool, input, actor, options = {}) {
  const data = validateMissionTimeEntryCreate(input);
  const owner = psaLocalScope(actor);
  const sha = digest(data);
  const uuid = options.uuid ?? randomUUID; // injectable ONLY by trusted test caller
  return psaTransaction(pool, async c => {
    const findPrevious = () => c.query(
      'SELECT id,mission_id,work_item_id,work_date::text AS work_date,minutes,'
      + 'status,billing_state,content_sha256 FROM enkyron_psa_time_entries '
      + 'WHERE workspace_key=$1 AND request_id=$2 FOR KEY SHARE',
      [owner.workspace, data.request_id]
    );
    const previous = (await findPrevious()).rows[0];
    if (previous) return sameRequest(previous, sha, false);

    const mission = (await c.query(
      'SELECT id,status FROM enkyron_psa_missions '
      + 'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.workspace, data.mission_id]
    )).rows[0];
    if (!mission || mission.status !== 'planning')
      throw new Error('PSA planning mission not found in local workspace');

    if (data.work_item_id) {
      const linked = (await c.query(
        'SELECT id FROM enkyron_psa_work_items '
        + 'WHERE workspace_key=$1 AND mission_id=$2 AND id=$3 FOR KEY SHARE',
        [owner.workspace, data.mission_id, data.work_item_id]
      )).rows[0];
      if (!linked) throw new Error('PSA time item not linked to selected mission');
    }

    const id = psaUuid(uuid(), 'generated time ID');
    const inserted = (await c.query(
      'INSERT INTO enkyron_psa_time_entries '
      + '(id,workspace_key,mission_id,work_item_id,work_date,minutes,note,'
      + 'request_id,content_sha256,created_by) '
      + 'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '
      + 'ON CONFLICT (workspace_key,request_id) DO NOTHING '
      + 'RETURNING id,mission_id,work_item_id,work_date::text AS work_date,'
      + 'minutes,status,billing_state,content_sha256',
      [id, owner.workspace, data.mission_id, data.work_item_id, data.work_date,
       data.minutes, data.note, data.request_id, sha, owner.actor]
    )).rows[0];
    if (!inserted) return sameRequest((await findPrevious()).rows[0], sha, false);
    await c.query(
      'INSERT INTO enkyron_psa_time_events '
      + '(id,workspace_key,mission_id,time_entry_id,event_type,request_id,'
      + 'content_sha256,actor_local) '
      + "VALUES($1,$2,$3,$4,'logged',$5,$6,$7)",
      [psaUuid(uuid(), 'generated time event ID'), owner.workspace,
       data.mission_id, id, data.request_id, sha, owner.actor]
    );
    return sameRequest(inserted, sha, true);
  });
}

/** Scoped, bounded list + separate full synthetic draft-time total. */
export async function listMissionTimeEntries(pool, missionId, actor) {
  const owner = psaLocalScope(actor), mission = psaUuid(missionId, 'mission ID');
  const exists = (await pool.query(
    'SELECT id FROM enkyron_psa_missions WHERE workspace_key=$1 AND id=$2',
    [owner.workspace, mission]
  )).rows[0];
  if (!exists) throw new Error('PSA mission not found in local workspace');

  const result = await pool.query(
    'SELECT id,mission_id,work_item_id,work_date::text AS work_date,minutes,note,'
    + 'status,billing_state,created_at FROM enkyron_psa_time_entries '
    + 'WHERE workspace_key=$1 AND mission_id=$2 '
    + 'ORDER BY work_date DESC,created_at DESC,id DESC LIMIT 51',
    [owner.workspace, mission]
  );
  const count = (await pool.query(
    'SELECT count(*)::int AS entries,coalesce(sum(minutes),0)::bigint AS minutes '
    + 'FROM enkyron_psa_time_entries WHERE workspace_key=$1 AND mission_id=$2',
    [owner.workspace, mission]
  )).rows[0];
  const totalMinutes = Number(count.minutes);
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes < 0)
    throw new Error('PSA time total out of safe range');
  return {items: result.rows.slice(0, 50), more: result.rows.length > 50,
    entries: count.entries, total_minutes: totalMinutes,
    approved: false, billable: false};
}
