// Archive-only email HTML preview must be bounded and scoped, with no write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {localMailMessages} from '../desktop/enkyron-mail-local.mjs';

const thread='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
test('archived email HTML reaches native preview as bounded data, not a provider fetch',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('to_regclass('))return {rows:[{ready:true}]};
    return {rows:[{
      id:'11111111-2222-4333-8444-555555555555',
      subject:'Invitation to Nepal-Europe',
      text:'None',html_inert:'<h1>Invitation</h1><p>Dear Guillaume</p>',
      html_preview_truncated:false,archive_state:'body_captured',
      preview_truncated:false,
    }]};
  }};
  const output=await localMailMessages(pool,'emprex',{mailbox:'support',thread_id:thread});
  assert.equal(output.items.length,1);
  assert.equal(output.items[0].text,'None');
  assert.match(output.items[0].html_inert,/Dear Guillaume/);
  assert.match(calls[1].sql,/LEFT\(a\.body_html_inert,20000\)/);
  assert.match(calls[1].sql,/AS html_preview_truncated/);
  assert.deepEqual(calls[1].params,['local:emprex','support',thread]);
  assert.equal(calls.length,2);
});

test('when archive 113 is absent, local Mail remains text only',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    return sql.includes('to_regclass(')
      ?{rows:[{ready:false}]}
      :{rows:[{text:'Existing readable text',html_only:false}]};
  }};
  const output=await localMailMessages(pool,'emprex',{mailbox:'support',thread_id:thread});
  assert.equal(output.items[0].text,'Existing readable text');
  assert.doesNotMatch(calls[1].sql,/body_html_inert/);
  assert.equal(calls.length,2);
});
