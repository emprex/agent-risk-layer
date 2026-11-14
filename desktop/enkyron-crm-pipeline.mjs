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
      +"SELECT id,prospect_id,company_id,owner_local,company_name_at_creation,stage,next_action,"
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
      +") SELECT id,prospect_id,company_id,owner_local,company_name_at_creation,stage,next_action,due_date,"
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
        company_id:row.company_id??null,owner_local:row.owner_local??null,
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

const PIPELINE_PAGE_SIZE=25;
const PIPELINE_PAGE_SORT=Object.freeze({
  updated:'updated_at DESC,id ASC',
  due:'due_date ASC NULLS LAST,updated_at DESC,id ASC',
  company:'LOWER(company_name_at_creation) ASC,id ASC'
});
const STAGE_LANE_SQL="CASE WHEN stage IN ('research','qualified') THEN 'prospecting' "
  +"WHEN stage IN ('contact_planned','contacted','discovery') THEN 'engagement' "
  +"WHEN stage IN ('proposal','negotiation') THEN 'proposal' "
  +"WHEN stage='won' THEN 'won' WHEN stage='lost' THEN 'lost' ELSE NULL END";

export function validatePipelinePageRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||Object.keys(input).some(k=>!['lane','page','search','sort'].includes(k)))
    throw new Error('CRM invalid pipeline page request');
  const lane=input.lane??'all',page=input.page??1,search=input.search??'';
  const sort=input.sort??'updated';
  if(lane!=='all'&&!PIPELINE_LANES.some(x=>x.id===lane))
    throw new Error('CRM invalid pipeline lane');
  if(!Number.isSafeInteger(page)||page<1||page>10000)
    throw new Error('CRM invalid pipeline page');
  if(typeof search!=='string'||search.length>100||/[\x00-\x1f\x7f]/.test(search))
    throw new Error('CRM invalid pipeline search');
  if(!Object.hasOwn(PIPELINE_PAGE_SORT,sort))
    throw new Error('CRM invalid pipeline sort');
  return {lane,page,search:search.trim(),sort};
}

/** Paginated, read-only view: no per-stage 30-row ceiling or data duplication. */
export async function getSalesPipelinePage(pool,input,actor){
  const req=validatePipelinePageRequest(input);
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  const workspaceKey='local:'+actor;
  try{
    const grouped=await pool.query(
      "SELECT stage,count(*)::integer AS total FROM enkyron_crm_opportunities "
      +"WHERE workspace_key=$1 GROUP BY stage",[workspaceKey]
    );
    const lanes=PIPELINE_LANES.map(x=>({...x,total:0}));
    const byLane=new Map(lanes.map(l=>[l.id,l]));
    for(const row of grouped.rows){
      const lane=byLane.get(pipelineLane(row.stage));
      if(!Number.isSafeInteger(row.total)||row.total<0)
        throw new Error('CRM invalid pipeline count');
      lane.total+=row.total;
    }
    const scoped="WITH scoped AS (SELECT id,prospect_id,company_id,owner_local,"
      +"company_name_at_creation,stage,next_action,due_date,probability_percent,"
      +"version,updated_at,("+STAGE_LANE_SQL+") AS lane "
      +"FROM enkyron_crm_opportunities WHERE workspace_key=$1) ";
    const where=" WHERE ($2='all' OR lane=$2) "
      +"AND ($3='' OR POSITION(LOWER($3) IN LOWER(company_name_at_creation))>0 "
      +"OR POSITION(LOWER($3) IN LOWER(COALESCE(next_action,'')))>0)";
    const params=[workspaceKey,req.lane,req.search];
    const count=await pool.query(scoped+"SELECT count(*)::integer AS total FROM scoped"+where,params);
    const total=count.rows[0]?.total;
    if(!Number.isSafeInteger(total)||total<0)
      throw new Error('CRM invalid pipeline page count');
    const order=PIPELINE_PAGE_SORT[req.sort];
    const page=await pool.query(
      scoped+"SELECT id,prospect_id,company_id,owner_local,company_name_at_creation,"
      +"stage,next_action,due_date,probability_percent,version,updated_at,lane "
      +"FROM scoped"+where+" ORDER BY "+order+" LIMIT $4 OFFSET $5",
      [...params,PIPELINE_PAGE_SIZE,(req.page-1)*PIPELINE_PAGE_SIZE]
    );
    if(page.rows.length>PIPELINE_PAGE_SIZE)
      throw new Error('CRM invalid pipeline page size');
    const seen=new Set();
    const items=page.rows.map(row=>{
      if(!row.id||seen.has(row.id)||pipelineLane(row.stage)!==row.lane)
        throw new Error('CRM invalid pipeline page row');
      seen.add(row.id);
      return {...row,company_id:row.company_id??null,
        owner_local:row.owner_local??null,probability_percent:row.probability_percent??null};
    });
    return {available:true,lanes,overall_total:lanes.reduce((x,l)=>x+l.total,0),
      total,page:req.page,page_size:PIPELINE_PAGE_SIZE,
      total_pages:Math.max(1,Math.ceil(total/PIPELINE_PAGE_SIZE)),
      lane:req.lane,search:req.search,sort:req.sort,items,
      notice:'Manual pipeline stages; no automatic outreach or commercial approval.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Commercial pipeline is not available until CRM setup is complete.'};
    throw error;
  }
}


// Scalable sales-pipeline browser. Counts are independent of page/search,
// and the actual records come from server-side pagination, never a 30-card
// preview. This is deliberately read-only and operator-workspace scoped.
import { boundedSearch } from './enkyron-contract.mjs';

export const PIPELINE_PAGE_SIZE = 25;
const PIPELINE_CASE = "CASE WHEN stage IN ('research','qualified') THEN 'prospecting' "
  +"WHEN stage IN ('contact_planned','contacted','discovery') THEN 'engagement' "
  +"WHEN stage IN ('proposal','negotiation') THEN 'proposal' "
  +"WHEN stage='won' THEN 'won' ELSE 'lost' END";

export function validatePipelinePageRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key=>!['lane','page','search'].includes(key))) {
    throw new Error('CRM invalid pipeline page request');
  }
  const lane=input.lane??'all',page=input.page??1;
  const search=boundedSearch(input.search??'');
  if (lane!=='all' && !PIPELINE_LANES.some(item=>item.id===lane))
    throw new Error('CRM invalid pipeline lane');
  if (!Number.isSafeInteger(page)||page<1||page>100000)
    throw new Error('CRM invalid pipeline page number');
  return {lane,page,search};
}

export async function getSalesPipelinePage(pool,actor,request){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  const {lane,page,search}=validatePipelinePageRequest(request);
  const workspace='local:'+actor;
  try{
    const counts=await pool.query(
      'SELECT '+PIPELINE_CASE+' AS lane,count(*)::integer AS n '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1 '
      +'GROUP BY lane', [workspace]
    );
    const lanes=PIPELINE_LANES.map(item=>({...item,total:0}));
    for(const row of counts.rows){
      const item=lanes.find(value=>value.id===row.lane);
      if(!item||!Number.isSafeInteger(row.n)||row.n<0)
        throw new Error('CRM invalid pipeline totals');
      item.total=row.n;
    }
    const where=' WHERE workspace_key=$1 '
      +'AND ($2::text = \'all\' OR '+PIPELINE_CASE+'=$2::text) '
      +'AND ($3::text = \'\' OR POSITION(LOWER($3::text) IN LOWER(company_name_at_creation))>0 '
      +'OR POSITION(LOWER($3::text) IN LOWER(COALESCE(next_action,\'\')))>0)';
    const params=[workspace,lane,search];
    const countRows=await pool.query(
      'SELECT count(*)::integer AS n FROM enkyron_crm_opportunities'+where,
      params
    );
    const filteredTotal=countRows.rows[0]?.n;
    if(!Number.isSafeInteger(filteredTotal)||filteredTotal<0)
      throw new Error('CRM invalid filtered pipeline total');
    const pages=Math.max(1,Math.ceil(filteredTotal/PIPELINE_PAGE_SIZE));
    const actualPage=Math.min(page,pages);
    const offset=(actualPage-1)*PIPELINE_PAGE_SIZE;
    const result=await pool.query(
      'SELECT id,prospect_id,company_id,owner_local,company_name_at_creation,'
      +'stage,next_action,due_date,probability_percent,version,updated_at '
      +'FROM enkyron_crm_opportunities'+where
      +' ORDER BY due_date ASC NULLS LAST,updated_at DESC,id '
      +'LIMIT $4::integer OFFSET $5::integer',
      [...params,PIPELINE_PAGE_SIZE,offset]
    );
    const seen=new Set();
    const items=result.rows.map(row=>{
      if(typeof row.id!=='string'||seen.has(row.id))
        throw new Error('CRM duplicate pipeline opportunity');
      pipelineLane(row.stage); // Reject unrecognized future stages explicitly.
      seen.add(row.id);
      return {
        id:row.id,prospect_id:row.prospect_id??null,
        company_id:row.company_id??null,owner_local:row.owner_local??null,
        company_name_at_creation:row.company_name_at_creation,
        stage:row.stage,next_action:row.next_action,due_date:row.due_date,
        probability_percent:row.probability_percent??null,
        version:row.version,updated_at:row.updated_at
      };
    });
    if(items.length>PIPELINE_PAGE_SIZE)
      throw new Error('CRM pipeline page exceeds limit');
    return {available:true,lanes,total:lanes.reduce((n,item)=>n+item.total,0),
      filtered_total:filteredTotal,page:actualPage,pages,
      page_size:PIPELINE_PAGE_SIZE,items,
      notice:'Opportunity stages are recorded manually; no customer message is sent.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],
      notice:'Commercial pipeline is not available until CRM setup is complete.'};
    throw error;
  }
}
