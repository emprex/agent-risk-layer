import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDossierLink,
  linkAttachmentToDossier,
  listDossierDocuments,
  listAttachmentDossierLinks
} from '../desktop/enkyron-mail-document-dossier-links.mjs';

const id='11111111-1111-4111-8111-111111111111';
const input={
  mailbox:'direction',
  message_id:id,
  attachment_id:id,
  destination_kind:'company',
  destination_id:'company-abc',
  review_note:'Explicitly reviewed document for this company',
  confirmed:true
};

test('explicit identity and confirmation required',()=>{
  assert.equal(validateDossierLink(input).destination_kind,'company');

  for(const change of [
    {confirmed:false},
    {destination_kind:'other'},
    {message_id:'bad'},
    {destination_id:'../../etc'},
    {review_note:'short'}
  ]){
    assert.throws(()=>validateDossierLink({...input,...change}));
  }
});

test('denied mailbox cannot save document',async()=>{
  const calls=[];
  const db={
    query:async sql=>{
      calls.push(sql);
      return {rows:[{can_read:false}]};
    },
    release:()=>{}
  };

  await assert.rejects(
    linkAttachmentToDossier({connect:async()=>db},'emprex',input),
    /denied/
  );

  assert.equal(calls.some(s=>s.startsWith('INSERT')),false);
  assert.ok(calls.includes('ROLLBACK'));
});

test('metadata-only document cannot be linked as stored',async()=>{
  const calls=[];
  const db={
    query:async sql=>{
      calls.push(sql);
      if(sql.startsWith('SELECT can_read'))
        return {rows:[{can_read:true}]};
      if(sql.startsWith('SELECT q.original_filename'))
        return {rows:[{safety_state:'metadata_only',stored:false}]};
      return {rows:[]};
    },
    release:()=>{}
  };

  await assert.rejects(
    linkAttachmentToDossier({connect:async()=>db},'emprex',input),
    /quarantine/
  );

  assert.equal(calls.some(s=>s.startsWith('INSERT')),false);
});

test('reviewed company link references the original file',async()=>{
  const calls=[];
  const sha='a'.repeat(64);
  const db={
    query:async (sql,params=[])=>{
      calls.push({sql,params});
      if(sql.startsWith('SELECT can_read'))
        return {rows:[{can_read:true}]};
      if(sql.startsWith('SELECT q.original_filename'))
        return {rows:[{
          original_filename:'test.md',
          content_sha256:sha,
          safety_state:'quarantined_unscanned',
          stored:true,
          crm_company_id:null
        }]};
      if(sql.startsWith('SELECT id FROM enkyron_crm_companies'))
        return {rows:[{id:'company-abc'}]};
      if(sql.startsWith('INSERT INTO enkyron_mail_document_dossier_links'))
        return {rowCount:1};
      return {rows:[]};
    },
    release:()=>{}
  };

  const result=await linkAttachmentToDossier(
    {connect:async()=>db},'emprex',input,{uuid:()=>id}
  );

  assert.equal(result.linked,true);
  assert.equal(result.safety_state,'quarantined_unscanned');
  const insert=calls.find(x=>x.sql.startsWith('INSERT'));
  assert.equal(insert.params[8],sha);
  assert.equal(insert.sql.includes('content_bytes'),false);
  assert.equal(calls.at(-1).sql,'COMMIT');
});


test('M05-B2 CRM document listing returns metadata', async () => {
  let query = '';
  let params = [];
  const pool = {
    query: async (sql, values) => {
      query = sql;
      params = values;
      return {rows:[{filename:'test.md'}]};
    }
  };
  const result = await listDossierDocuments(pool,'emprex',{
    destination_kind:'company',destination_id:'company-abc'
  });
  assert.equal(result.available,true);
  assert.equal(result.items[0].filename,'test.md');
  assert.deepEqual(params,['local:emprex','company-abc']);
  assert.ok(query.includes('d.company_id=$2'));
  assert.ok(!query.includes('content_bytes'));
});

test('M05-B2 ticket listing uses ticket identity', async () => {
  let query = '';
  const pool = {query:async sql => {
    query=sql;
    return {rows:[]};
  }};
  const result = await listDossierDocuments(pool,'emprex',{
    destination_kind:'ticket',
    destination_id:'ARL-2026-000008'
  });
  assert.equal(result.available,true);
  assert.ok(query.includes('d.ticket_id=$2'));
});

test('M05-B2 exact attachment association lookup', async () => {
  const uuid='11111111-1111-4111-8111-111111111111';
  let query = '';
  const pool={query:async sql=>{
    query=sql;
    return {rows:[]};
  }};
  const result=await listAttachmentDossierLinks(pool,'emprex',{
    mailbox:'direction',
    message_id:uuid,
    attachment_id:uuid
  });
  assert.equal(result.available,true);
  assert.ok(query.includes('d.attachment_id=$4'));
  assert.ok(!query.includes('content_bytes'));
});

test('M05-B2 missing schema is reported safely', async () => {
  const pool={query:async()=>{
    const error=new Error('Missing table');
    error.code='42P01';
    throw error;
  }};
  const result=await listDossierDocuments(pool,'emprex',{
    destination_kind:'company',
    destination_id:'company-abc'
  });
  assert.equal(result.available,false);
  assert.deepEqual(result.items,[]);
});
