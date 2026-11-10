// ENKYRON: real, read-only sales workload summary for the local OS operator.
// Derived from PostgreSQL in one statement snapshot. Never infer email delivery.
export async function getSalesOverview(pool,actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  const workspace='local:'+actor;
  try{
    const result=await pool.query(
      'WITH london_today AS ('
      +"SELECT (now() AT TIME ZONE 'Europe/London')::date AS d"
      +'), operator_opps AS ('
      +'SELECT id,prospect_id,company_name_at_creation,stage,next_action,due_date '
      +'FROM enkyron_crm_opportunities WHERE workspace_key=$1'
      +'), counters AS ('
      +'SELECT count(*)::int AS opportunities, '
      +"count(*) FILTER (WHERE stage NOT IN ('won','lost'))::int AS active_opportunities, "
      +"count(*) FILTER (WHERE stage NOT IN ('won','lost') "
      +'AND due_date < (SELECT d FROM london_today))::int AS overdue, '
      +"count(*) FILTER (WHERE stage NOT IN ('won','lost') "
      +'AND due_date = (SELECT d FROM london_today))::int AS due_today, '
      +"count(*) FILTER (WHERE stage NOT IN ('won','lost') "
      +'AND due_date > (SELECT d FROM london_today) '
      +'AND due_date <= (SELECT d FROM london_today) + 7)::int AS due_next_week '
      +'FROM operator_opps'
      +') SELECT '
      +'(SELECT count(*)::int FROM sales_prospects) AS researched_prospects, '
      +'(SELECT count(*)::int FROM enkyron_crm_companies WHERE workspace_key=$1) '
      +'AS registered_companies, '
      +'(SELECT count(*)::int FROM enkyron_crm_mail_drafts WHERE workspace_key=$1) '
      +'AS saved_drafts, '
      +'counters.*,london_today.d::text AS as_of, '
      +'COALESCE((SELECT json_agg(upcoming ORDER BY due_date,id) FROM ('
      +'SELECT id,company_name_at_creation,stage,next_action,due_date '
      +'FROM operator_opps '
      +"WHERE stage NOT IN ('won','lost') AND due_date IS NOT NULL "
      +'ORDER BY due_date ASC,id ASC LIMIT 6'
      +") upcoming), '[]'::json) AS priority_items "
      +'FROM counters CROSS JOIN london_today',
      [workspace]
    );
    const value=result.rows[0];
    if(!value||!Array.isArray(value.priority_items)||
      value.priority_items.length>6)throw new Error('CRM invalid sales overview response');
    for(const key of ['researched_prospects','registered_companies','saved_drafts',
      'opportunities','active_opportunities','overdue','due_today','due_next_week']){
      if(!Number.isSafeInteger(value[key])||value[key]<0)
        throw new Error('CRM invalid sales overview count');
    }
    return {available:true,overview:value,
      note:'Commercial figures reflect local records, not verified sales.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,
      notice:'Commercial overview is unavailable until the CRM database is set up.'};
    throw error;
  }
}
