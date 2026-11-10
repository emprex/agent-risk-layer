import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePersonalProfile,recordPersonalProfile,readPersonalProfile}
  from '../desktop/enkyron-operator-personal-profile.mjs';

const profile={expected_revision:0,display_name:'Synthetic Founder',
  job_title:'Founder',organization_display:'Synthetic Ltd',
  work_email:'founder@example.invalid',confirmed:true};
test('UX-15 personal profile validates human information without accepting authority flags',()=>{
  assert.deepEqual(validatePersonalProfile({...profile,role:'super-admin'}),
    (({confirmed,...data})=>data)(profile));
  for(const invalid of [
    null,{},[],{...profile,confirmed:false},
    {...profile,expected_revision:-1},
    {...profile,display_name:'  '},
    {...profile,display_name:'Admin\nSuper'},
    {...profile,display_name:'Founder\u202e'},
    {...profile,job_title:'A'},
    {...profile,organization_display:''},
    {...profile,work_email:'a@example.invalid;cc@example.invalid'},
    {...profile,work_email:'bad@'},
  ])assert.throws(()=>validatePersonalProfile(invalid),/CRM/);
  assert.equal(validatePersonalProfile({...profile,work_email:''}).work_email,'');
});
test('UX-15 transaction stores only personal display fields under the immutable Linux workspace key',async()=>{
  const q=[];
  const pool={connect:async()=>({
    query:async(sql,args)=>{
      q.push({sql,args});
      if(sql.startsWith('SELECT revision,display_name'))return {rows:[]};
      if(sql.startsWith('INSERT'))return {rows:[{revision:1}]};
      return {rows:[]};
    },
    release:()=>q.push({sql:'RELEASE'})
  })};
  const x=await recordPersonalProfile(pool,profile,'synthetic-local',{
    uuid:()=> '11111111-2222-4333-8444-555555555555'
  });
  assert.equal(x.revision,1);
  const insert=q.find(x=>x.sql.startsWith('INSERT'));
  assert.equal(insert.args[1],'local:synthetic-local');
  assert.equal(insert.args[3],'Synthetic Founder');
  assert.equal(insert.args[7],'synthetic-local');
  assert.ok(!/password|auth_role|access_grant|team_id/.test(insert.sql));
  assert.deepEqual(q.filter(x=>x.sql==='COMMIT').length,1);
});
test('UX-15 stale versions and no-op writes rollback; read is scoped',async()=>{
  for(const state of ['stale','same']){
    const q=[];
    const pool={connect:async()=>({
      query:async(sql,args)=>{
        q.push(sql);
        if(sql.startsWith('SELECT revision,display_name'))
          return {rows:[{revision:state==='stale'?2:0,
            display_name:profile.display_name,job_title:profile.job_title,
            organization_display:profile.organization_display,work_email:profile.work_email}]};
        return {rows:[]};
      },release:()=>{}
    })};
    await assert.rejects(()=>recordPersonalProfile(pool,profile,'synthetic-local'),/CRM/);
    assert.equal(q.at(-1),'ROLLBACK');
    assert.ok(!q.some(x=>x.startsWith('INSERT')));
  }
  const calls=[];
  const pool={query:async(sql,args)=>{calls.push(args);return {rows:[{
    revision:1,display_name:'Synthetic Founder',job_title:'Founder'
  }]} }};
  const r=await readPersonalProfile(pool,'synthetic-local');
  assert.equal(r.current.display_name,'Synthetic Founder');
  assert.deepEqual(calls[0],['local:synthetic-local']);
  assert.match(r.notice,/NOT enabled/);
});
test('UX-15 IPC contains all three command classifications exactly once',async()=>{
  const source=await readFile(new URL('../desktop/enkyron-bridge.mjs',import.meta.url),'utf8');
  const lines=source.split('\n');
  for(const token of ["if (!['tickets'","const payload = [","const readOnly = !["]){
    const l=lines.find(x=>x.includes(token));
    assert.ok(l,'Missing bridge command list '+token);
    assert.equal(l.split("'operator-profile-save'").length-1,1,
      'Personal profile save command missing/duplicated in '+token);
  }
  assert.match(source,/command === 'operator-profile' \? await readPersonalProfile/);
  assert.match(source,/command === 'operator-profile-save' \? await recordPersonalProfile/);
});
