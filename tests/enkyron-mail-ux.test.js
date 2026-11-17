import test from 'node:test';
import assert from 'node:assert/strict';
import {localMailFolders,localMailList} from '../desktop/enkyron-mail-local.mjs';

const thread='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function mockMail({order='newest'}={}){
  const queries=[];
  const pool={query:async(sql,args)=>{
    queries.push({sql,args});
    if(sql.includes('enkyron_mail_local_folders'))
      return {rows:[{folder_key:'user_mission',name:'Mission inquiries'}]};
    if(sql.includes('COUNT(*)::int AS unread_count'))
      return {rows:[{folder_key:'inbox',unread_count:2},
                    {folder_key:'user_mission',unread_count:1}]};
    return {rows:[{id:thread,mailbox:'support',last_message_at:'2026-11-17T06:19:00Z'}]};
  }};
  return {pool,queries};
}
test('folder tree shows actual unread counts, including user folders',async()=>{
  const {pool,queries}=mockMail();
  const data=await localMailFolders(pool,'emprex');
  const byKey=new Map(data.folders.map(f=>[f.key,f]));
  assert.equal(byKey.get('inbox').unread_count,2);
  assert.equal(byKey.get('user_mission').unread_count,1);
  assert.equal(byKey.get('sent').unread_count,0);
  assert.equal(queries.length,2);
  assert.deepEqual(queries[1].args,['local:emprex']);
  assert.match(queries[1].sql,/unread=TRUE/);
});
test('newest is default, explicit oldest reverses database ordering',async()=>{
  for(const [sort,direction] of [['newest','DESC'],['oldest','ASC']]){
    const {pool,queries}=mockMail();
    const value=await localMailList(pool,'emprex',{
      mailbox:'support',folder:'inbox',sort,page:0});
    assert.equal(value.sort,sort);
    assert.match(queries[0].sql,new RegExp('ORDER BY sort_at '+direction));
    assert.match(queries[0].sql,/MAX\(m_sort\.created_at\)/);
    assert.match(queries[0].sql,/LEFT JOIN LATERAL/);
    assert.deepEqual(queries[0].args.slice(0,3),
      ['local:emprex','inbox','support']);
  }
});
test('sort input never becomes SQL',async()=>{
  const {pool,queries}=mockMail();
  await assert.rejects(localMailList(pool,'emprex',{sort:'newest;DROP TABLE x'}),
    /Invalid Mail sort order/);
  assert.equal(queries.length,0);
});
