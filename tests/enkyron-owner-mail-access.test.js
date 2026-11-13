import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNER_MAILBOXES,ownerMailAccessCard,ownerMailboxPermission}
  from '../desktop/enkyron-owner-mail-access.mjs';

const org='org:fixture';
const owner=Object.freeze({
  loginName:'ceo',role:'organization_owner_l5',verified:true,status:'active',
  principalId:'owner-principal',personId:'owner-person',organizationId:org
});

test('owner card lists exactly two distinct corporate mailboxes and the L5 role',()=>{
  const card=ownerMailAccessCard({display_name:'Example Founder'});
  assert.equal(card.name,'Example Founder');
  assert.equal(card.login,'ceo');
  assert.equal(card.position,'CEO');
  assert.equal(card.role,'organization_owner_l5');
  assert.deepEqual(card.mailboxes.map(m=>m.address),[
    'guillaume.strohecker@agentrisklayer.com','support@agentrisklayer.com'
  ]);
  assert.equal(new Set(card.mailboxes.map(m=>m.address)).size,2);
  assert.equal(card.connection,'not_connected');
  assert.equal(card.account_status,'not_authenticated');
  assert.equal(OWNER_MAILBOXES.length,2);
});

test('read access belongs only to verified active ceo in matching organization',()=>{
  assert.equal(ownerMailboxPermission(owner,org,'direction','read'),true);
  assert.equal(ownerMailboxPermission(owner,org,'support','read'),true);
  for(const p of [null,{...owner,verified:false},{...owner,status:'pending'},
    {...owner,role:'supervisor_l4'},{...owner,loginName:'other'},
    {...owner,organizationId:'org:other'}]){
    assert.equal(ownerMailboxPermission(p,org,'support','read'),false);
  }
});

test('assigned mailbox does not automatically permit sending without confirmation',()=>{
  assert.equal(ownerMailboxPermission(owner,org,'support','send'),false);
  assert.equal(ownerMailboxPermission(owner,org,'direction','reply'),false);
  assert.equal(ownerMailboxPermission(owner,org,'direction','send',
    {humanConfirmed:true,recipientVerified:false}),false);
  assert.equal(ownerMailboxPermission(owner,org,'direction','send',
    {humanConfirmed:true,recipientVerified:true}),true);
});

test('owner can link mail to company/ticket using separate CRM policy',()=>{
  assert.equal(ownerMailboxPermission(owner,org,'support','link_ticket'),true);
  assert.equal(ownerMailboxPermission(owner,org,'direction','link_company'),true);
  assert.equal(ownerMailboxPermission(owner,org,'unknown','read'),false);
  assert.equal(ownerMailboxPermission(owner,org,'support','delete'),false);
  assert.equal(ownerMailboxPermission(owner,'org:wrong','support','read'),false);
});
