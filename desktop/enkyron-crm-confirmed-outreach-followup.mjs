// ENK-OUTREACH-7D-20261118: event-driven CRM follow-up for confirmed sends.
// Only same-workspace explicit company/opportunity links. Never calls a provider.
import {randomUUID} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ELIGIBLE=new Set(['research','qualified','contact_planned','contacted']);
function dueInSevenDays(sentAt){
  const time=new Date(sentAt);
  if(!Number.isFinite(time.getTime()))throw new Error('Invalid confirmed outbound time');
  // Calendar dates in the audited CRM are ISO dates. UTC is explicit, no host
  // locale ambiguity; on 18 Nov this produces 25 Nov.
  const stamp=time.toISOString().slice(0,10);
  const midnight=Date.parse(stamp+'T00:00:00Z');
  return {sentDay:stamp,dueDay:new Date(midnight+7*86400000).toISOString().slice(0,10)};
}
function dbDate(value){
  if(value==null)return null;
  return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
}

/** Called ONLY after a saved manual-send attestation or accepted provider ID.
 * Caller controls transaction. Returns reasons for safe no-op without writing.
 */
export async function syncConfirmedOutreachFollowup(client,{
  workspaceKey,actor,draftId,sentAt,proofKind,uuid=randomUUID
}){
  if(typeof workspaceKey!=='string'||!/^local:[A-Za-z0-9_.-]{1,80}$/.test(workspaceKey)
      ||typeof actor!=='string'||workspaceKey!=='local:'+actor
      ||typeof draftId!=='string'||!UUID.test(draftId)
      ||!['provider_accepted','external_operator_reported'].includes(proofKind))
    throw new Error('Invalid confirmed outreach source');

  const draft=(await client.query(
    'SELECT id,company_id,opportunity_id,recipient_email,mailbox_key '
    +'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2',
    [workspaceKey,draftId]
  )).rows[0];
  if(!draft)return {updated:false,reason:'draft_not_found'};
  if(draft.mailbox_key!=='direction')return {updated:false,reason:'non_sales_mailbox'};
  if(!draft.company_id&&!draft.opportunity_id)
    return {updated:false,reason:'no_explicit_crm_link'};
  if(typeof draft.recipient_email!=='string'||
      !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(draft.recipient_email))
    return {updated:false,reason:'missing_verified_recipient'};

  // A company-owned outbound email must use an exact company contact, never
  // a guessed link based on email domain or company name.
  if(draft.company_id){
    const contact=(await client.query(
      'SELECT 1 FROM enkyron_crm_contacts '
      +'WHERE workspace_key=$1 AND company_id=$2 '
      +'AND LOWER(email)=LOWER($3) LIMIT 1',
      [workspaceKey,draft.company_id,draft.recipient_email]
    )).rows[0];
    if(!contact)return {updated:false,reason:'recipient_not_matching_company_contact'};
  }

  const time=new Date(sentAt);
  if(!Number.isFinite(time.getTime()))throw new Error('Invalid outbound send timestamp');
  const {sentDay,dueDay}=dueInSevenDays(time.toISOString());
  const channel=proofKind==='provider_accepted'
    ?'accepted by Resend (delivery not verified)'
    :'reported sent externally by operator (delivery not verified)';
  const nextAction=
    `Outbound email to ${draft.recipient_email} on ${sentDay}: ${channel}. `+
    `Awaiting response; follow up by email on ${dueDay} if no reply. `+
    'No reply, buyer interest or client agreement confirmed.';
  if(nextAction.length>1000)throw new Error('CRM follow-up length invalid');

  // Lock the same per-company advisory key as manual creation. Concurrent
  // email sends or a manual create cannot both create a direct opportunity.
  if(draft.company_id&&!draft.opportunity_id){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [workspaceKey+':company-opportunity:'+draft.company_id]);
  }

  let opportunities;
  if(draft.opportunity_id){
    opportunities=(await client.query(
      'SELECT o.id,o.stage,o.next_action,o.due_date,o.version,o.probability_percent '
      +'FROM enkyron_crm_opportunities o '
      +'WHERE o.workspace_key=$1 AND o.id=$2 FOR UPDATE OF o',
      [workspaceKey,draft.opportunity_id]
    )).rows;
  }else{
    opportunities=(await client.query(
      'SELECT o.id,o.stage,o.next_action,o.due_date,o.version,o.probability_percent '
      +'FROM enkyron_crm_opportunities o WHERE o.workspace_key=$1 '
      +'AND o.stage NOT IN (\'won\',\'lost\') AND ('
      +'(o.company_id=$2 AND (o.source_ticket_id IS NULL OR EXISTS ('
      +'SELECT 1 FROM enkyron_crm_effective_ticket_links e '
      +'WHERE e.workspace_key=o.workspace_key AND e.company_id=o.company_id '
      +'AND e.ticket_id=o.source_ticket_id))) OR EXISTS ('
      +'SELECT 1 FROM enkyron_crm_prospect_links l '
      +'WHERE l.workspace_key=o.workspace_key AND l.prospect_id=o.prospect_id '
      +'AND l.company_id=$2)) '
      +'ORDER BY o.id LIMIT 2 FOR UPDATE OF o',
      [workspaceKey,draft.company_id]
    )).rows;
  }
  if(opportunities.length>1)
    return {updated:false,reason:'multiple_opportunities'};

  if(opportunities.length===0){
    // Create an opportunity only after a confirmed outbound message, exact
    // company link, verified matching contact AND a prior human qualification.
    if(!draft.company_id||draft.opportunity_id)
      return {updated:false,reason:'no_opportunity'};
    const qualification=(await client.query(
      'SELECT fit_status FROM enkyron_crm_qualification_reviews '
      +'WHERE workspace_key=$1 AND company_id=$2 '
      +'ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [workspaceKey,draft.company_id]
    )).rows[0];
    if(!qualification||!['needs_research','potential_fit'].includes(qualification.fit_status))
      return {updated:false,reason:'company_not_qualified_for_outreach'};

    // An archived/closed opportunity is not a reason to create a fresh deal.
    // The unique direct-company key is retained; never mask history.
    const other=(await client.query(
      'SELECT 1 FROM enkyron_crm_opportunities o '
      +'WHERE o.workspace_key=$1 AND ('
      +'o.company_id=$2 OR EXISTS ('
      +'SELECT 1 FROM enkyron_crm_prospect_links l '
      +'WHERE l.workspace_key=o.workspace_key AND l.prospect_id=o.prospect_id '
      +'AND l.company_id=$2)) LIMIT 1',
      [workspaceKey,draft.company_id]
    )).rows[0];
    if(other)return {updated:false,reason:'existing_unavailable_company_opportunity'};
    const company=(await client.query(
      'SELECT id,name FROM enkyron_crm_companies '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [workspaceKey,draft.company_id]
    )).rows[0];
    if(!company||typeof company.name!=='string'||!company.name.trim())
      return {updated:false,reason:'company_not_found'};

    const id=uuid();
    const created=(await client.query(
      'INSERT INTO enkyron_crm_opportunities '
      +'(id,workspace_key,prospect_id,company_id,source_ticket_id,'
      +'company_name_at_creation,stage,next_action,due_date,owner_local) '
      +"VALUES($1,$2,NULL,$3,NULL,$4,'contacted',$5,$6,$7) RETURNING id,version",
      [id,workspaceKey,company.id,company.name,nextAction,dueDay,actor]
    )).rows[0];
    if(!created||created.id!==id)
      throw new Error('CRM opportunity creation not verified');
    await client.query(
      'INSERT INTO enkyron_crm_opportunity_events '
      +'(id,workspace_key,opportunity_id,event_type,new_stage,new_next_action,'
      +'new_due_date,actor_local) '
      +"VALUES($1,$2,$3,'created','contacted',$4,$5,$6)",
      [uuid(),workspaceKey,id,nextAction,dueDay,actor]
    );
    return {updated:true,created:true,opportunity_id:id,stage:'contacted',
      next_action:nextAction,due_date:dueDay,version:created.version};
  }

  const old=opportunities[0];
  // Do not override a manual Contacted/Discovery date or action. The default
  // is established at FIRST contact, not repeated over subsequent sends.
  if(old.stage==='contacted'){
    if(old.next_action===nextAction&&dbDate(old.due_date)===dueDay)
      return {updated:false,reason:'already_synchronised',opportunity_id:old.id};
    return {updated:false,reason:'existing_contacted_followup_preserved',
      opportunity_id:old.id};
  }
  if(!new Set(['research','qualified','contact_planned']).has(old.stage))
    return {updated:false,reason:'advanced_or_closed_stage'};
  if(!Number.isSafeInteger(old.version)||old.version<1)
    throw new Error('Invalid CRM opportunity version');
  const priorDate=dbDate(old.due_date);
  const updated=(await client.query(
    'UPDATE enkyron_crm_opportunities '
    +"SET stage='contacted',next_action=$3,due_date=$4,version=version+1,updated_at=NOW() "
    +'WHERE workspace_key=$1 AND id=$2 AND version=$5 RETURNING id,version',
    [workspaceKey,old.id,nextAction,dueDay,old.version]
  )).rows[0];
  if(!updated)throw new Error('CRM opportunity changed during outbound sync');
  await client.query(
    'INSERT INTO enkyron_crm_opportunity_events '
    +'(id,workspace_key,opportunity_id,event_type,old_stage,new_stage,'
    +'old_next_action,new_next_action,old_due_date,new_due_date,actor_local,'
    +'old_probability_percent,new_probability_percent) '
    +"VALUES($1,$2,$3,'updated',$4,'contacted',$5,$6,$7,$8,$9,$10,$10)",
    [uuid(),workspaceKey,old.id,old.stage,old.next_action,nextAction,
      priorDate,dueDay,actor,old.probability_percent??null]
  );
  return {updated:true,created:false,opportunity_id:old.id,stage:'contacted',
    next_action:nextAction,due_date:dueDay,version:updated.version};
}

/** Best effort AFTER Resend's provider outcome has been durably recorded.
 * A failure never re-sends mail, rewrites a provider receipt or misreports
 * the opportunity as updated.
 */
export async function syncProviderAcceptedFollowup(pool,actor,draftId,options={}){
  const client=await pool.connect();
  let begun=false;
  try{
    await client.query('BEGIN');begun=true;
    const result=await syncConfirmedOutreachFollowup(client,{
      workspaceKey:'local:'+actor,actor,draftId,
      sentAt:new Date().toISOString(),proofKind:'provider_accepted',
      uuid:options.uuid??randomUUID
    });
    await client.query('COMMIT');begun=false;
    return result;
  }catch(error){
    if(begun)await client.query('ROLLBACK').catch(()=>{});
    return {updated:false,reason:'crm_followup_error'};
  }finally{client.release();}
}
