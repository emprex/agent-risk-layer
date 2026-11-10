// ENKYRON commercial pipeline: read-only operator-scoped preview of existing
// opportunities. Manual stage changes use the existing audited opportunity API.
export const PIPELINE_LANES=Object.freeze([
  {id:'prospecting',title:'Prospecting'},
  {id:'engagement',title:'Engagement'},
  {id:'proposal',title:'Proposals'},
  {id:'won',title:'Won'},
  {id:'lost',title:'Lost'}
]);
const LIMIT_PER_LANE=30;
export function pipelineLane(stage){
  if(['research','qualified'].includes(stage))return 'prospecting';
  if(['contact_planned','contacted','discovery'].includes(stage))return 'engagement';
  if(['proposal','negotiation'].includes(stage))return 'proposal';
  if(stage==='won')return 'won';
  if(stage==='lost')return 'lost';
  throw new Error('CRM unknown pipeline stage');
}
export async function getSalesPipeline(pool,actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  try{
    const result=await pool.query(
      "WITH grouped AS ("
      +"SELECT id,prospect_id,company_name_at_creation,stage,next_action,"
      +"due_date,probability_percent,version,updated_at,"
      +"CASE WHEN stage IN ('research','qualified') THEN 'prospecting' "
      +"WHEN stage IN ('contact_planned','contacted','discovery') THEN 'engagement' "
      +"WHEN stage IN ('proposal','negotiation') THEN 'proposal' "
      +"WHEN stage='won' THEN 'won' ELSE 'lost' END AS lane "
      +"FROM enkyron_crm_opportunities WHERE workspace_key=$1"
      +"), ranked AS ("
      +"SELECT *,count(*) OVER (PARTITION BY lane)::integer AS lane_total,"
      +"row_number() OVER (PARTITION BY lane ORDER BY updated_at DESC,id) AS lane_rank "
      +"FROM grouped"
      +") SELECT id,prospect_id,company_name_at_creation,stage,next_action,due_date,"
      +"probability_percent,version,updated_at,lane,lane_total "
      +"FROM ranked WHERE lane_rank <= 30 "
      +"ORDER BY CASE lane WHEN 'prospecting' THEN 1 "
      +"WHEN 'engagement' THEN 2 WHEN 'proposal' THEN 3 "
      +"WHEN 'won' THEN 4 ELSE 5 END,lane_rank",
      ['local:'+actor]
    );
    const lanes=PIPELINE_LANES.map(item=>({
      id:item.id,title:item.title,total:0,items:[],more:false
    }));
    const byId=new Map(lanes.map(lane=>[lane.id,lane]));
    const seen=new Set();
    for(const row of result.rows){
      const lane=byId.get(row.lane);
      if(!lane||pipelineLane(row.stage)!==row.lane)
        throw new Error('CRM invalid pipeline stage mapping');
      if(typeof row.id!=='string'||seen.has(row.id))
        throw new Error('CRM duplicate pipeline opportunity');
      if(!Number.isSafeInteger(row.lane_total)||row.lane_total<1)
        throw new Error('CRM invalid pipeline count');
      if(lane.total&&lane.total!==row.lane_total)
        throw new Error('CRM inconsistent pipeline snapshot');
      lane.total=row.lane_total;
      lane.items.push({
        id:row.id,prospect_id:row.prospect_id,
        company_name_at_creation:row.company_name_at_creation,
        stage:row.stage,next_action:row.next_action,due_date:row.due_date,
        probability_percent:row.probability_percent??null,version:row.version,updated_at:row.updated_at
      });
      seen.add(row.id);
    }
    for(const lane of lanes){
      if(lane.items.length>LIMIT_PER_LANE||lane.total<lane.items.length)
        throw new Error('CRM invalid pipeline preview bounds');
      lane.more=lane.total>lane.items.length;
    }
    return {available:true,lanes,total:lanes.reduce((s,l)=>s+l.total,0),
      preview_per_lane:LIMIT_PER_LANE,
      notice:'Pipeline stages reflect manually updated opportunities only.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Commercial pipeline is not available until CRM setup is complete.'};
    throw error;
  }
}
