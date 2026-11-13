import test from 'node:test';
import assert from 'node:assert/strict';
import {authoriseEnkyronOperation as allow, ENKYRON_ACCESS_ROLES}
  from '../desktop/enkyron-access-policy.mjs';

const base={verified:true,status:'active',principalId:'p-guillaume',
  personId:'human-one',organizationId:'org-arl',role:'organization_owner_l5',
  teamIds:[],clientIds:[],missionIds:[]};
const dev={...base,principalId:'p-emprex',role:'developer_privileged'};
const resource={organizationId:'org-arl'};
const decision=(principal,action,extra={})=>allow(principal,action,{...resource,...extra});

test('UX-15B separates role names from verified principals; unknown roles and actions fail closed',()=>{
  assert.ok(ENKYRON_ACCESS_ROLES.includes('service_desk_l1'));
  assert.ok(!ENKYRON_ACCESS_ROLES.includes('viewer'));
  for(const bad of [null,{...base,verified:false},{...base,status:'revoked'},
    {...base,personId:''},{...base,role:'owner'},{...base,role:'viewer'},
    {...base,principalId:'emprex',verified:false}])
    assert.equal(decision(bad,'crm:read').allowed,false);
  assert.deepEqual(decision(base,'invented:privileged-action'),
    {allowed:false,reason:'unknown-operation'});
});

test('UX-15B CEO and Developer see confidential data inside the authorized organization',()=>{
  for(const principal of [base,dev]){
    for(const operation of ['crm:read','crm:write','finance:read','finance:manage',
      'account:manage','development:manage','audit:read','document:read_confidential'])
      assert.equal(decision(principal,operation).allowed,true,operation);
    assert.deepEqual(decision(principal,'crm:read',{organizationId:'org-other'}),
      {allowed:false,reason:'organization-boundary'});
  }
});

test('UX-15B immutable evidence and audit history cannot be changed by Owner or Developer',()=>{
  for(const principal of [base,dev]){
    for(const action of ['audit:delete','audit:rewrite','evidence:delete','evidence:rewrite',
      'assessment:approve_own','assessment:erase_history','assessment:run_without_authorisation'])
      assert.deepEqual(decision(principal,action),
        {allowed:false,reason:'integrity-protected'});
  }
});

test('UX-15B support L1 resolves assigned tickets but has no general CRM or other client visibility',()=>{
  const l1={...base,role:'service_desk_l1',principalId:'p-l1',
    clientIds:['client-a'],teamIds:['service-desk']};
  assert.equal(decision(l1,'ticket:create',{teamId:'service-desk',clientId:'client-a'}).allowed,true);
  assert.equal(decision(l1,'ticket:resolve',{ticketId:'t1',assignedTo:'p-l1',clientId:'client-a'}).allowed,true);
  assert.equal(decision(l1,'ticket:escalate',{ticketId:'t1',teamId:'service-desk',clientId:'client-a'}).allowed,true);
  assert.equal(decision(l1,'knowledge:read_approved',{approved:true}).allowed,true);
  assert.equal(decision(l1,'knowledge:read_approved',{approved:false}).allowed,false);
  assert.equal(decision(l1,'ticket:read',{ticketId:'t2',clientId:'client-other'}).allowed,false);
  assert.equal(decision(l1,'ticket:read').allowed,false);
  assert.equal(decision(l1,'crm:read').allowed,false);
  assert.equal(decision(l1,'account:manage').allowed,false);
  assert.equal(decision(l1,'assessment:test_execute').allowed,false);
});

test('UX-15B support L2 and engineering L3 need assignments and explicit test authorization',()=>{
  const l2={...base,role:'technical_support_l2',principalId:'p-l2',
    clientIds:['client-a'],teamIds:['support']};
  assert.equal(decision(l2,'ticket:diagnose',
    {ticketId:'t1',teamId:'support',clientId:'client-a'}).allowed,true);
  assert.equal(decision(l2,'finance:read').allowed,false);
  const l3={...base,role:'security_engineer_l3',principalId:'p-l3',
    missionIds:['mission-a']};
  const target={missionId:'mission-a',targetSha:'a'.repeat(40),
    scopeFrozen:true,authorisationVerified:true};
  assert.equal(decision(l3,'assessment:test_execute',target).allowed,true);
  assert.equal(decision(l3,'assessment:test_execute',{...target,authorisationVerified:false}).allowed,false);
  assert.equal(decision(l3,'assessment:test_execute',{...target,missionId:'mission-other'}).allowed,false);
  assert.equal(decision(base,'assessment:test_execute',{...target,scopeFrozen:false}).allowed,false);
  assert.equal(decision(dev,'assessment:test_execute',{...target,targetSha:'wrong'}).allowed,false);
});

test('UX-15B same human cannot impersonate a second reviewer via CEO and Developer identities',()=>{
  const review={preparedByPersonId:'human-one',independentReviewAuthorised:true};
  assert.equal(decision(base,'assessment:review',review).allowed,false);
  assert.equal(decision(dev,'assessment:review',review).allowed,false);
  assert.equal(decision(base,'assessment:review',
    {...review,preparedByPersonId:'other-human'}).allowed,true);
  assert.equal(decision(base,'assessment:review',
    {...review,preparedByPersonId:'other-human',independentReviewAuthorised:false}).allowed,false);
});

test('UX-15B client portal can only access its own tickets and published documents',()=>{
  const client={...base,role:'client_portal_user',principalId:'p-client',
    clientId:'client-a'};
  assert.equal(decision(client,'ticket:create',{clientId:'client-a'}).allowed,true);
  assert.equal(decision(client,'ticket:read',{ticketId:'t1',clientId:'client-a'}).allowed,true);
  assert.equal(decision(client,'ticket:read',{ticketId:'t1',clientId:'client-b'}).allowed,false);
  assert.equal(decision(client,'document:read_published',
    {clientId:'client-a',published:false}).allowed,false);
  assert.equal(decision(client,'document:read_published',
    {clientId:'client-a',published:true}).allowed,true);
  assert.equal(decision(client,'document:read_confidential',{clientId:'client-a'}).allowed,false);
});

test('UX-15B external email sending still requires human destination review',()=>{
  assert.equal(decision(base,'email:send').allowed,false);
  assert.equal(decision(dev,'email:send',{humanConfirmed:true,recipientVerified:false}).allowed,false);
  assert.equal(decision(dev,'email:send',{humanConfirmed:true,recipientVerified:true}).allowed,true);
});
