// ENK-08: planning-only mission tasks/milestones. Not a second Calendar task store.
// No remote RBAC; actor MUST originate from the trusted local OS bridge.
import {createHash, randomUUID} from 'node:crypto';
import {validateMissionTaskCreate, validateMissionTaskCompletion}
  from './enkyron-psa-planning-contract.mjs';
import {psaLocalScope, psaUuid, psaTransaction} from './enkyron-psa-db.mjs';

const hash = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const createHashFor = d => hash([d.mission_id,d.kind,d.title,d.due_date,'open']);
const completionHashFor = d => hash([d.mission_id,d.task_id,d.expected_version,true]);

function sameCreate(row, sha, created) {
  if (!row || row.content_sha256.trim() !== sha)
    throw new Error('PSA request ID reused with different task content');
  return {id:row.id,mission_id:row.mission_id,kind:row.kind,
    status:row.status,version:row.version,created,
    notice:'Internal mission work item only; no customer or security approval.'};
}

function sameCompletion(row, data, sha) {
  if (!row || row.event_type !== 'completed' || row.item_id !== data.task_id
      || row.mission_id !== data.mission_id
      || row.content_sha256.trim() !== sha)
    throw new Error('PSA request ID reused for another operation');
  return {id:data.task_id,mission_id:data.mission_id,status:'completed',version:2,
    changed:false,notice:'Task completion does not approve a customer engagement.'};
}

export async function createMissionWorkItem(pool,input,actor,options={}) {
  const data=validateMissionTaskCreate(input),owner=psaLocalScope(actor);
  const sha=createHashFor(data),generateId=options.uuid??randomUUID;
  return psaTransaction(pool,async c=>{
    const earlier=(await c.query(
      'SELECT id,mission_id,kind,status,version,content_sha256 '
      +'FROM enkyron_psa_work_items WHERE workspace_key=$1 AND request_id=$2 FOR KEY SHARE',
      [owner.workspace,data.request_id]
    )).rows[0];
    if (earlier) return sameCreate(earlier,sha,false);

    const mission=(await c.query(
      'SELECT id,status FROM enkyron_psa_missions '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [owner.workspace,data.mission_id]
    )).rows[0];
    if (!mission || mission.status!=='planning')
      throw new Error('PSA planning mission not found in local workspace');

    const id=psaUuid(generateId(),'generated work item ID');
    const created=(await c.query(
      'INSERT INTO enkyron_psa_work_items '
      +'(id,workspace_key,mission_id,kind,title,due_date,request_id,content_sha256,created_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) '
      +'ON CONFLICT (workspace_key,request_id) DO NOTHING '
      +'RETURNING id,mission_id,kind,status,version,content_sha256',
      [id,owner.workspace,data.mission_id,data.kind,data.title,data.due_date,
       data.request_id,sha,owner.actor]
    )).rows[0];
    if (!created) {
      const winner=(await c.query(
        'SELECT id,mission_id,kind,status,version,content_sha256 '
        +'FROM enkyron_psa_work_items WHERE workspace_key=$1 AND request_id=$2 FOR KEY SHARE',
        [owner.workspace,data.request_id]
      )).rows[0];
      return sameCreate(winner,sha,false);
    }
    await c.query(
      'INSERT INTO enkyron_psa_work_item_events '
      +'(id,workspace_key,mission_id,item_id,version,event_type,request_id,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,1,'created',$5,$6,$7)",
      [psaUuid(generateId(),'generated event ID'),owner.workspace,data.mission_id,id,
       data.request_id,sha,owner.actor]
    );
    return sameCreate(created,sha,true);
  });
}

export async function completeMissionWorkItem(pool,input,actor,options={}) {
  const data=validateMissionTaskCompletion(input),owner=psaLocalScope(actor);
  const sha=completionHashFor(data),generateId=options.uuid??randomUUID;
  return psaTransaction(pool,async c=>{
    const findEvent=()=>c.query(
      'SELECT mission_id,item_id,event_type,content_sha256 '
      +'FROM enkyron_psa_work_item_events WHERE workspace_key=$1 AND request_id=$2',
      [owner.workspace,data.request_id]
    );
    const prev=(await findEvent()).rows[0];
    if (prev) return sameCompletion(prev,data,sha);
    const item=(await c.query(
      'SELECT id,mission_id,status,version FROM enkyron_psa_work_items '
      +'WHERE workspace_key=$1 AND id=$2 AND mission_id=$3 FOR UPDATE',
      [owner.workspace,data.task_id,data.mission_id]
    )).rows[0];
    if (!item)throw new Error('PSA work item not found in local mission');
    if (item.status!=='open') {
      // Concurrent replay waits on this row lock: recheck the committed event.
      const committed=(await findEvent()).rows[0];
      if (committed)return sameCompletion(committed,data,sha);
      throw new Error('PSA work item is already closed');
    }
    if (item.version!==data.expected_version)
      throw new Error('PSA task revision changed; reload before completion');
    const updated=(await c.query(
      'UPDATE enkyron_psa_work_items '
      +"SET status='completed',version=2,completed_at=NOW(),completed_by=$4 "
      +"WHERE workspace_key=$1 AND id=$2 AND mission_id=$3 AND status='open' AND version=$5 "
      +'RETURNING id',
      [owner.workspace,data.task_id,data.mission_id,owner.actor,data.expected_version]
    )).rows[0];
    if (!updated)throw new Error('PSA task revision conflict');
    await c.query(
      'INSERT INTO enkyron_psa_work_item_events '
      +'(id,workspace_key,mission_id,item_id,version,event_type,request_id,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,2,'completed',$5,$6,$7)",
      [psaUuid(generateId(),'generated event ID'),owner.workspace,data.mission_id,data.task_id,
       data.request_id,sha,owner.actor]
    );
    return {id:data.task_id,mission_id:data.mission_id,status:'completed',version:2,
      changed:true,notice:'Task completion does not approve a customer engagement.'};
  });
}

export async function listMissionWorkItems(pool,missionId,actor){
  const id=psaUuid(missionId,'mission ID'),owner=psaLocalScope(actor);
  const found=(await pool.query(
    'SELECT id FROM enkyron_psa_missions WHERE workspace_key=$1 AND id=$2',
    [owner.workspace,id]
  )).rows[0];
  if(!found)throw new Error('PSA mission not found in local workspace');
  const items=(await pool.query(
    'SELECT w.id,w.mission_id,w.kind,w.title,w.due_date::text AS due_date,'
    +'w.status,w.version,w.created_at,w.completed_at '
    +'FROM enkyron_psa_work_items w WHERE w.workspace_key=$1 AND w.mission_id=$2 '
    +"ORDER BY CASE WHEN w.status='open' THEN 0 ELSE 1 END,"
    +'w.due_date ASC NULLS LAST,w.id LIMIT 101',
    [owner.workspace,id]
  )).rows;
  return {items:items.slice(0,100),more:items.length>100};
}
