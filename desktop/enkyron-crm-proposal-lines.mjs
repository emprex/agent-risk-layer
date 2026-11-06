// ENKYRON quote lines: voluntary, operator-entered details of UNISSUED proposals.
// A single transaction replaces lines and updates the stored proposal total
// and optimistic revision. No tax inference, external action or client promotion.
import {createHash,randomUUID} from 'node:crypto';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TOTAL=999999999;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  return {key:'local:'+actor,actor};
}
export function validateProposalLines(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.proposal_id!=='string'||!ID.test(input.proposal_id)||
    !Number.isSafeInteger(input.expected_revision)||input.expected_revision<1||
    !Array.isArray(input.lines)||input.lines.length<1||input.lines.length>25)
    throw new Error('CRM invalid proposal line items');
  let total=0;
  const lines=input.lines.map((line)=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||
      typeof line.description!=='string'||line.description.length>500||
      /[\x00-\x1f\x7f]/.test(line.description)||
      line.description.trim().length<5||
      !Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>10000||
      !Number.isSafeInteger(line.unit_price_minor)||line.unit_price_minor<1||
      line.unit_price_minor>MAX_TOTAL)
      throw new Error('CRM invalid quote line description, quantity or unit price');
    const description=line.description.trim();
    const line_total_minor=line.quantity*line.unit_price_minor;
    total+=line_total_minor;
    if(!Number.isSafeInteger(total)||total>MAX_TOTAL)
      throw new Error('CRM quoted fee exceeds supported maximum');
    return {description,quantity:line.quantity,
      unit_price_minor:line.unit_price_minor,line_total_minor};
  });
  return {proposal_id:input.proposal_id,expected_revision:input.expected_revision,
    lines,total_minor:total};
}
export async function readProposalLines(pool,id,actor){
  if(typeof id!=='string'||!ID.test(id))
    throw new Error('CRM invalid proposal identifier');
  const key=owner(actor).key;
  try{
    const rows=(await pool.query(
      'SELECT d.id,d.revision,d.amount_minor,d.currency,d.title,'
      +'l.description,l.quantity,l.unit_price_minor,l.line_total_minor,l.position '
      +'FROM enkyron_crm_proposal_drafts d '
      +'LEFT JOIN enkyron_crm_proposal_lines l '
      +'ON l.proposal_id=d.id AND l.workspace_key=d.workspace_key '
      +'WHERE d.workspace_key=$1 AND d.id=$2 '
      +'ORDER BY l.position ASC NULLS LAST',[key,id]
    )).rows;
    if(!rows.length)throw new Error('CRM proposal not found in local workspace');
    const first=rows[0],lines=rows.filter(x=>x.position!==null).map(x=>({
      description:x.description,quantity:Number(x.quantity),
      unit_price_minor:Number(x.unit_price_minor),
      line_total_minor:Number(x.line_total_minor)
    }));
    const total=lines.reduce((x,l)=>x+l.line_total_minor,0);
    if(lines.length>25||lines.length&&total!==Number(first.amount_minor))
      throw new Error('CRM proposal total does not match its saved lines');
    return {available:true,id,revision:first.revision,
      currency:first.currency,amount_minor:Number(first.amount_minor),
      lines,uses_lines:lines.length>0};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Detailed quote lines require the latest CRM update.'};
    throw error;
  }
}
export async function replaceProposalLines(pool,input,actor,options={}){
  const data=validateProposalLines(input),o=owner(actor),uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query(
      'SELECT id,title,scope_text,currency,revision '
      +'FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [o.key,data.proposal_id]
    )).rows[0];
    if(!current)throw new Error('CRM proposal not found in local workspace');
    if(current.revision!==data.expected_revision)
      throw new Error('CRM proposal changed since it was opened; reopen latest version');
    const old=(await client.query(
      'SELECT description,quantity,unit_price_minor '
      +'FROM enkyron_crm_proposal_lines WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY position',[o.key,data.proposal_id]
    )).rows;
    if(old.length===data.lines.length&&old.every((x,i)=>
      x.description===data.lines[i].description&&
      Number(x.quantity)===data.lines[i].quantity&&
      Number(x.unit_price_minor)===data.lines[i].unit_price_minor))
      throw new Error('CRM quote lines have no changes to save');
    const version=current.revision+1;
    await client.query('DELETE FROM enkyron_crm_proposal_lines '
      +'WHERE workspace_key=$1 AND proposal_id=$2',[o.key,data.proposal_id]);
    for(const [index,line] of data.lines.entries()){
      await client.query(
        'INSERT INTO enkyron_crm_proposal_lines '
        +'(id,workspace_key,proposal_id,position,description,quantity,unit_price_minor) '
        +'VALUES($1,$2,$3,$4,$5,$6,$7)',
        [uuid(),o.key,data.proposal_id,index+1,
          line.description,line.quantity,line.unit_price_minor]
      );
    }
    const updated=(await client.query(
      'UPDATE enkyron_crm_proposal_drafts '
      +'SET amount_minor=$3,revision=$4,updated_by=$5,updated_at=NOW() '
      +'WHERE workspace_key=$1 AND id=$2 AND revision=$6 '
      +'RETURNING revision',[o.key,data.proposal_id,data.total_minor,
        version,o.actor,current.revision]
    )).rows[0];
    if(!updated)throw new Error('CRM proposal revision conflict');
    const hash=createHash('sha256').update(JSON.stringify([
      current.title,current.scope_text,current.currency,data.total_minor,
      data.lines.map(x=>[x.description,x.quantity,x.unit_price_minor])
    ])).digest('hex');
    await client.query(
      'INSERT INTO enkyron_crm_proposal_draft_events '
      +'(id,workspace_key,proposal_id,revision,event_type,content_sha256,actor_local) '
      +"VALUES($1,$2,$3,$4,'edited',$5,$6)",
      [uuid(),o.key,data.proposal_id,version,hash,o.actor]
    );
    await client.query('COMMIT');
    return {id:data.proposal_id,revision:version,total_minor:data.total_minor,
      notice:'Detailed quote saved as a draft. No tax, issue, send or assessment action.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
