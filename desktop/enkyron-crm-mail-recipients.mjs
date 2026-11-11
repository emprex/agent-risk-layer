// ENKYRON CRM address suggestions, local-workspace scoped and read-only.
// A matching name/address is NOT proof of identity, permission or delivery.
const SAFE_OPERATOR = /^[A-Za-z0-9_.-]{1,80}$/;
const VALID_QUERY = /^[^\x00-\x1f\x7f]{2,120}$/;

function workspace(actor){
  if(typeof actor!=='string'||!SAFE_OPERATOR.test(actor))
    throw new Error('CRM invalid local operator');
  return 'local:'+actor;
}
export function recipientSearchTerm(input){
  if(typeof input!=='string'||input.length>120||/[\x00-\x1f\x7f]/.test(input))
    throw new Error('CRM invalid recipient search');
  const term=input.trim();
  return term.length>=2?term:'';
}
export async function suggestMailRecipients(pool,input,actor){
  const key=workspace(actor),term=recipientSearchTerm(input);
  if(!term)return {available:true,items:[],more:false};
  const result=await pool.query(
    'SELECT c.id AS contact_id,c.company_id,c.full_name,c.job_title,c.email, '
    +'co.name AS company_name FROM enkyron_crm_contacts c '
    +'JOIN enkyron_crm_companies co ON co.workspace_key=c.workspace_key AND co.id=c.company_id '
    +'WHERE c.workspace_key=$1 AND c.relationship_state<>\'inactive\' '
    +'AND co.relationship_state<>\'inactive\' AND NULLIF(btrim(c.email),\'\') IS NOT NULL '
    +'AND (POSITION(lower($2) IN lower(c.full_name))>0 '
    +'OR POSITION(lower($2) IN lower(c.email))>0 '
    +'OR POSITION(lower($2) IN lower(co.name))>0) '
    +'ORDER BY c.full_name ASC,c.id ASC LIMIT 13',
    [key,term]
  );
  return {available:true,items:result.rows.slice(0,12),more:result.rows.length>12};
}

// Only associate a standalone outgoing draft automatically when EXACTLY ONE
// active CRM contact has this exact address in the same local workspace.
// Ambiguous or unknown recipients remain independent; no guessing by domain.
export async function uniqueCompanyForRecipient(db,email,actor){
  const key=workspace(actor);
  if(typeof email!=='string'||!email||email.length>254||/[\s<>;,]/.test(email))
    return null;
  const matches=(await db.query(
    'SELECT c.company_id FROM enkyron_crm_contacts c '
    +'JOIN enkyron_crm_companies co ON co.workspace_key=c.workspace_key AND co.id=c.company_id '
    +'WHERE c.workspace_key=$1 AND c.relationship_state<>\'inactive\' '
    +'AND co.relationship_state<>\'inactive\' '
    +'AND lower(btrim(c.email))=lower($2) '
    +'ORDER BY c.id ASC LIMIT 2',
    [key,email.trim()]
  )).rows;
  return matches.length===1?matches[0].company_id:null;
}

export async function verifiedContactForCompany(db,contactId,companyId,email,actor){
  const key=workspace(actor);
  if(typeof contactId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).test(contactId))
    throw new Error('CRM invalid recipient contact');
  const rows=(await db.query(
    'SELECT c.id FROM enkyron_crm_contacts c '
    +'JOIN enkyron_crm_companies co ON co.workspace_key=c.workspace_key AND co.id=c.company_id '
    +'WHERE c.workspace_key=$1 AND c.id=$2 AND c.company_id=$3 '
    +'AND lower(btrim(c.email))=lower($4) '
    +'AND c.relationship_state<>\'inactive\' AND co.relationship_state<>\'inactive\' LIMIT 1',
    [key,contactId,companyId,email]
  )).rows;
  if(rows.length!==1)throw new Error('CRM recipient no longer matches the selected company/contact');
  return true;
}
