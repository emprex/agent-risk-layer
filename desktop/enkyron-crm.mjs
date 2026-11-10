// ENKYRON CRM: structured local companies and contacts, no automatic outreach.
// Legacy sales_prospects remains separate and unmodified.
// The OS-local workspace key is NOT multi-user authentication or an Internet boundary.
import { randomUUID } from 'node:crypto';
import { boundedSearch } from './enkyron-contract.mjs';
import {queryCompanyCandidates,queryContactCandidates} from './enkyron-crm-duplicate-queries.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_CONTROLS = /[\x00-\x1f\x7f]/;

function value(input, label, max, required=false) {
  if (typeof input !== 'string' || input.length > max || NO_CONTROLS.test(input)) {
    throw new Error('CRM invalid ' + label);
  }
  const clean = input.trim();
  if (required && !clean) throw new Error('CRM ' + label + ' required');
  return clean;
}
function model(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CRM invalid request');
  }
  return input;
}
function workspace(actor) {
  const name = value(actor, 'local operator', 80, true);
  // This isolates local development records, not simultaneous remote users.
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('CRM invalid local operator');
  return { key: 'local:' + name, actor: name };
}
function websiteField(input) {
  const website = value(input, 'website', 500);
  if (website) {
    const hint = 'CRM website must be a web address (e.g. https://example.com), not an email. Leave it empty if unknown.';
    let url;
    try { url = new URL(website); } catch { throw new Error(hint); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
      throw new Error(hint);
    }
  }
  return website;
}
function emailField(input) {
  const email = value(input, 'email', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('CRM invalid email');
  }
  return email;
}

export function validateCompany(input) {
  const data = model(input);
  if (data.relationship_state && data.relationship_state !== 'prospect') {
    // Manually created records cannot be asserted as existing clients by default.
    throw new Error('CRM new companies start as prospects');
  }
  return {
    name: value(data.name, 'company name', 160, true),
    legal_name: value(data.legal_name ?? '', 'legal name', 160),
    sector: value(data.sector ?? '', 'sector', 120),
    city: value(data.city ?? '', 'city', 120),
    country: value(data.country ?? '', 'country', 90),
    website: websiteField(data.website ?? '')
  };
}

export function validateContact(input) {
  const data = model(input);
  if (typeof data.company_id !== 'string' || !UUID.test(data.company_id)) {
    throw new Error('CRM invalid company identifier');
  }
  if (data.marketing_permission && data.marketing_permission !== 'unknown') {
    throw new Error('CRM marketing opt-in requires separately verified consent');
  }
  return {
    company_id: data.company_id,
    full_name: value(data.full_name, 'contact name', 160, true),
    job_title: value(data.job_title ?? '', 'job title', 160),
    email: emailField(data.email ?? ''),
    phone: value(data.phone ?? '', 'phone', 80)
  };
}

export async function listCompanies(pool, search, actor) {
  const query = boundedSearch(search);
  const { key } = workspace(actor);
  try {
    const result = await pool.query(
      `SELECT id,name,legal_name,sector,city,country,website,relationship_state,
              source_type,record_version,created_at,updated_at
       FROM enkyron_crm_companies
       WHERE workspace_key=$1 AND
        ($2='' OR POSITION(LOWER($2) IN LOWER(name))>0
               OR POSITION(LOWER($2) IN LOWER(COALESCE(legal_name,'')))>0)
       ORDER BY updated_at DESC,id LIMIT 101`,
      [key, query]
    );
    return {
      available:true,items:result.rows.slice(0,100),
      more:result.rows.length>100,kind:'structured_companies'
    };
  } catch(error) {
    if (error?.code==='42P01') return {
      available:false,items:[],more:false,
      notice:'CRM company/contact schema 065 not installed on this local PostgreSQL database.'
    };
    throw error;
  }
}

export async function listContacts(pool, companyId, actor) {
  if (typeof companyId !== 'string' || !UUID.test(companyId)) {
    throw new Error('CRM invalid company identifier');
  }
  const {key}=workspace(actor);
  const company=(await pool.query(
    'SELECT id,name FROM enkyron_crm_companies WHERE id=$1 AND workspace_key=$2',
    [companyId,key]
  )).rows[0];
  if (!company) throw new Error('CRM company not found for local operator');
  const rows=(await pool.query(
    `SELECT id,full_name,job_title,email,phone,relationship_state,marketing_permission,
            record_version,created_at
     FROM enkyron_crm_contacts
     WHERE company_id=$1 AND workspace_key=$2 ORDER BY created_at DESC,id LIMIT 101`,
    [companyId,key]
  )).rows;
  return {company,items:rows.slice(0,100),more:rows.length>100};
}

async function transaction(pool, work) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}


const reviewUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateDuplicateReview(review) {
 if(review===undefined||review===null) return null;
 if(!review||typeof review!=='object'||Array.isArray(review)||
    Object.keys(review).some(k=>!['match_ids','review_note','confirmed'].includes(k)))
  throw new Error('CRM invalid duplicate review');
 if(review.confirmed!==true||!Array.isArray(review.match_ids)||
    review.match_ids.length<1||review.match_ids.length>25||
    review.match_ids.some(x=>typeof x!=='string'||!reviewUuid.test(x))||
    new Set(review.match_ids).size!==review.match_ids.length)
  throw new Error('CRM duplicate review requires confirmed matching record IDs');
 const note=value(review.review_note,'duplicate review rationale',500,true);
 if(note.length<30)throw new Error('CRM duplicate override requires 30-500 characters');
 return {match_ids:[...review.match_ids].sort(),review_note:note};
}
async function enforceDuplicateReview(client,kind,data,owner,review,uuid) {
 // This workspace-level advisory transaction lock serializes all core
 // manual company/contact creates. Run the candidate query AFTER obtaining it.
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
  [owner.key+':crm-manual-create']);
 const rows=kind==='company'
   ?await queryCompanyCandidates(client,data,owner.key)
   :await queryContactCandidates(client,data,owner.key);
 if(rows.length>25)throw new Error('CRM duplicate review exceeds 25 candidates; no record created');
 const current=rows.map(row=>row.id).sort();
 if(current.length===0){
  if(review)throw new Error('CRM duplicate review is stale; refresh before creating');
  return null;
 }
 if(!review)throw new Error('CRM possible duplicate found; human review required');
 if(JSON.stringify(current)!==JSON.stringify(review.match_ids))
  throw new Error('CRM duplicate matches changed; review new candidates before creating');
 return {matched_record_ids:current,review_note:review.review_note};
}
async function saveDuplicateReview(client,kind,id,owner,review,uuid) {
 if(!review)return;
 await client.query(
  'INSERT INTO enkyron_crm_duplicate_reviews '
  +'(id,workspace_key,resource_kind,resource_id,matched_record_ids,review_note,actor_local) '
  +'VALUES($1,$2,$3,$4,$5,$6,$7)',
  [uuid(),owner.key,kind,id,review.matched_record_ids,review.review_note,owner.actor]
 );
}

export async function createCompany(pool, input, actor, options={}) {
  const data=validateCompany(input);
  const owner=workspace(actor);
  const uuid=options.uuid ?? randomUUID;
  const review=validateDuplicateReview(input?.duplicate_review);
  return transaction(pool,async client=>{
    const duplicate=await enforceDuplicateReview(client,'company',data,owner,review,uuid);
    const id=uuid();
    await client.query(
      `INSERT INTO enkyron_crm_companies
       (id,workspace_key,name,legal_name,sector,city,country,website,
        relationship_state,source_type,owner_local)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'prospect','manual',$9)`,
      [id,owner.key,data.name,data.legal_name || null,
       data.sector || null,data.city || null,data.country || null,
       data.website || null,owner.actor]
    );
    await client.query(
      `INSERT INTO enkyron_crm_events
       (id,workspace_key,resource_kind,resource_id,event_type,actor_local)
       VALUES ($1,$2,'company',$3,'created',$4)`,
      [uuid(),owner.key,id,owner.actor]
    );
    await saveDuplicateReview(client,'company',id,owner,duplicate,uuid);
    return {id,name:data.name,relationship_state:'prospect'};
  });
}

export async function createContact(pool, input, actor, options={}) {
  const data=validateContact(input);
  const owner=workspace(actor);
  const review=validateDuplicateReview(input?.duplicate_review);
  const uuid=options.uuid ?? randomUUID;
  return transaction(pool,async client=>{
    const company=(await client.query(
      'SELECT id FROM enkyron_crm_companies WHERE id=$1 AND workspace_key=$2 FOR KEY SHARE',
      [data.company_id,owner.key]
    )).rows[0];
    if (!company) throw new Error('CRM company not found for local operator');
    const duplicate=await enforceDuplicateReview(client,'contact',data,owner,review,uuid);
    const id=uuid();
    await client.query(
      `INSERT INTO enkyron_crm_contacts
       (id,workspace_key,company_id,full_name,job_title,email,phone,owner_local)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,owner.key,data.company_id,data.full_name,data.job_title || null,
       data.email || null,data.phone || null,owner.actor]
    );
    await client.query(
      `INSERT INTO enkyron_crm_events
       (id,workspace_key,resource_kind,resource_id,event_type,actor_local)
       VALUES ($1,$2,'contact',$3,'created',$4)`,
      [uuid(),owner.key,id,owner.actor]
    );
    await saveDuplicateReview(client,'contact',id,owner,duplicate,uuid);
    return {id,company_id:data.company_id,full_name:data.full_name,
      relationship_state:'unverified',marketing_permission:'unknown'};
  });
}
