import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOutboundMove,validateEmptyTrash,emptyLocalTrash,
  listMovedOutboundMail,moveOutboundMail
} from '../desktop/enkyron-mail-folder-actions.mjs';

const UUID='11111111-2222-4333-8444-555555555555';
const mail={record_kind:'sent',record_id:UUID,mailbox_key:'direction',
  from_folder:'sent',to_folder:'trash',confirmed:true};

test('Sent/Drafts moving is operator-confirmed and never crosses system folders',()=>{
  assert.deepEqual(validateOutboundMove(mail),{
    record_kind:mail.record_kind,record_id:mail.record_id,mailbox_key:mail.mailbox_key,
    from_folder:mail.from_folder,to_folder:mail.to_folder
  });
  for(const bad of [
    {...mail,confirmed:false},{...mail,to_folder:'inbox'},
    {...mail,to_folder:'drafts'},{...mail,to_folder:'purged'},
    {...mail,from_folder:'purged'},{...mail,record_kind:'inbound'},
    {...mail,record_id:'wrong'}, {...mail,mailbox_key:'other'}
  ])assert.throws(()=>validateOutboundMove(bad),/Mail/);
  assert.deepEqual(validateOutboundMove({...mail,from_folder:'trash',
    to_folder:'previous'}).to_folder,'previous');
});

test('Empty Trash is separately confirmed and may scope one or all accounts',()=>{
  assert.deepEqual(validateEmptyTrash({mailbox:'all',confirmed:true}),{mailbox:'all'});
  assert.deepEqual(validateEmptyTrash({mailbox:'support',confirmed:true}),
    {mailbox:'support'});
  for(const bad of [{}, {confirmed:false}, {confirmed:true,mailbox:'other'}])
    assert.throws(()=>validateEmptyTrash(bad),/Mail|Trash/);
});

test('outbound folder listing reads local placements only, not provider APIs',async()=>{
  const calls=[];
  const pool={query:async(sql,values)=>{
    calls.push({sql,values});
    return {rows: sql.includes('enkyron_mail_send_attempts s ON')?
      [{id:UUID,record_kind:'sent',mailbox_key:'direction',
        subject:'Synthetic message',updated_at:'2026-11-16T10:00:00Z'}]:[]};
  }};
  const result=await listMovedOutboundMail(pool,'emprex',
    {folder:'trash',mailbox:'all'});
  assert.equal(result.available,true);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].record_kind,'sent');
  assert.ok(calls.every(call=>call.sql.trimStart().startsWith('SELECT')));
  assert.ok(calls.every(call=>call.values[0]==='local:emprex'));
});

test('outbound move checks canonical record, workspace, folder and audit in one transaction',async()=>{
  const calls=[];
  const client={query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT can_read'))return {rows:[{can_read:true}]};
    if(sql.includes('SELECT id,mailbox_key FROM enkyron_mail_send_attempts'))
      return {rows:[{id:UUID,mailbox_key:'direction'}]};
    if(sql.startsWith('SELECT folder_key,previous_folder,revision'))return {rows:[]};
    return {rows:[],rowCount:1};
  },release:()=>{}};
  const pool={connect:async()=>client};
  const res=await moveOutboundMail(pool,'emprex',mail,{uuidFactory:()=>UUID});
  assert.equal(res.moved,true);
  assert.equal(res.provider_unchanged,true);
  assert.ok(calls.some(x=>x.sql.includes('INSERT INTO enkyron_mail_outbound_locations')));
  assert.ok(calls.some(x=>x.sql.includes('INSERT INTO enkyron_mail_folder_events')));
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.ok(!calls.some(x=>/fetch|https?:|resend\.com/i.test(x.sql)));
});

test('Empty Trash records audit and hides local copies without deleting messages',async()=>{
  const calls=[];
  const client={query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT can_read'))return {rows:[{can_read:true}]};
    if(sql.startsWith('UPDATE enkyron_mail_local_threads'))
      return {rowCount:2,rows:[{thread_id:UUID},{thread_id:UUID}]};
    if(sql.startsWith('UPDATE enkyron_mail_outbound_locations'))
      return {rowCount:3,rows:[{record_id:UUID},{record_id:UUID},{record_id:UUID}]};
    return {rows:[],rowCount:1};
  },release:()=>{}};
  const outcome=await emptyLocalTrash({connect:async()=>client},
    'emprex',{mailbox:'all',confirmed:true},{uuidFactory:()=>UUID});
  assert.equal(outcome.removed_from_views,5);
  assert.equal(outcome.provider_unchanged,true);
  assert.equal(outcome.local_content_not_erased,true);
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.equal(calls.filter(x=>x.sql.startsWith('SELECT can_read')).length,2);
  assert.ok(!calls.some(x=>/^DELETE\s/i.test(x.sql)));
});
