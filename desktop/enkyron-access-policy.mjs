// UX-15B foundation: deterministic ENKYRON authorization contract.
// NOT an authentication provider. The caller must resolve the principal,
// scopes and resource facts from trusted server-side storage, never IPC JSON.
// Do not connect this policy to real desktop actions until an authenticated
// service boundary and operation-to-permission mapping have been implemented.
const grants=Object.freeze({
  service_desk_l1:Object.freeze(['ticket:create','ticket:read','ticket:update','ticket:resolve','ticket:escalate','knowledge:read_approved']),
  technical_support_l2:Object.freeze(['ticket:read','ticket:update','ticket:diagnose','ticket:resolve','ticket:escalate','knowledge:read_approved']),
  security_engineer_l3:Object.freeze(['ticket:read','ticket:diagnose','knowledge:read_approved','evidence:read','assessment:read','assessment:prepare','assessment:test_execute','assessment:propose','assessment:review']),
  supervisor_l4:Object.freeze(['ticket:create','ticket:read','ticket:update','ticket:assign','ticket:resolve','ticket:escalate','ticket:supervise','knowledge:read_approved','evidence:read','assessment:read','assessment:review']),
  organization_owner_l5:Object.freeze(['*']),
  developer_privileged:Object.freeze(['*']),
  client_portal_user:Object.freeze(['ticket:create','ticket:read','document:read_published']),
});
export const ENKYRON_ACCESS_ROLES=Object.freeze(Object.keys(grants));
const knownActions=new Set([
  ...Object.values(grants).flat().filter(x=>x!=='*'),
  // Privileged internal operations. New operations must be explicitly added.
  'crm:read','crm:write','finance:read','finance:manage',
  'account:manage','development:manage','audit:read',
  'document:read_confidential','configuration:manage','email:send',
]);
const immutableActions=new Set([
  'audit:delete','audit:rewrite','evidence:delete','evidence:rewrite',
  'assessment:approve_own','assessment:erase_history',
  'assessment:run_without_authorisation',
]);
function deny(reason){return {allowed:false,reason};}
function id(x){return typeof x==='string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(x);}
function includes(list,value){return Array.isArray(list)&&list.includes(value);}
function privileged(role){return role==='organization_owner_l5'||role==='developer_privileged';}

/**
 * Check a single ENKYRON action with verified service-side identity and scope.
 * principal: {verified, status, principalId, personId, organizationId, role,
 *             teamIds, clientIds, missionIds, clientId?}
 * resource: server-resolved {organizationId, ticketId?, assignedTo?, teamId?,
 *                            clientId?, missionId?, published?, ...}
 * This is a policy contract only: no desktop enforcement or session security yet.
 */
export function authoriseEnkyronOperation(principal,action,resource){
  if(!principal||principal.verified!==true||principal.status!=='active'
     ||!id(principal.principalId)||!id(principal.personId)
     ||!id(principal.organizationId)||!Object.hasOwn(grants,principal.role))
    return deny('unverified-principal');
  if(typeof action!=='string'||!action||!resource
     ||!id(resource.organizationId)||resource.organizationId!==principal.organizationId)
    return deny('organization-boundary');
  if(immutableActions.has(action))return deny('integrity-protected');
  if(!knownActions.has(action))return deny('unknown-operation');
  if(!grants[principal.role].includes('*')&&!grants[principal.role].includes(action))
    return deny('not-permitted');

  if(principal.role==='client_portal_user'){
    if(!id(principal.clientId)||!id(resource.clientId)
       ||resource.clientId!==principal.clientId)
      return deny('client-boundary');
    if(action==='document:read_published'&&resource.published!==true)
      return deny('not-published');
    if(action==='ticket:read'&&!id(resource.ticketId))
      return deny('ticket-scope-required');
  }else if(!privileged(principal.role)){
    // No unscoped employee access. Ticket operations require an assigned ticket
    // or a specifically allowed client and team queue.
    if(action.startsWith('ticket:')){
      const queue= id(resource.teamId)&&includes(principal.teamIds,resource.teamId)
        &&id(resource.clientId)&&includes(principal.clientIds,resource.clientId);
      const assigned=id(resource.assignedTo)&&resource.assignedTo===principal.principalId;
      if(!queue&&!assigned)return deny('ticket-scope');
      if(action!=='ticket:create'&&!id(resource.ticketId))
        return deny('ticket-scope-required');
    }
    if(action.startsWith('assessment:')||action==='evidence:read'){
      if(!id(resource.missionId)||!includes(principal.missionIds,resource.missionId))
        return deny('mission-scope');
    }
    if(action==='knowledge:read_approved'&&resource.approved!==true)
      return deny('knowledge-not-approved');
  }

  // Owner and Developer receive broad visibility inside their organization,
  // but not immunity from technical/legal prerequisites for external actions.
  if(action==='assessment:test_execute'){
    if(resource.authorisationVerified!==true||resource.scopeFrozen!==true
       ||typeof resource.targetSha!=='string'
       ||!/^[0-9a-f]{40}$/.test(resource.targetSha))
      return deny('test-authorisation-required');
  }
  if(action==='assessment:review'){
    if(!id(resource.preparedByPersonId)
       ||resource.preparedByPersonId===principal.personId
       ||resource.independentReviewAuthorised!==true)
      return deny('independent-review-required');
  }
  if(action==='email:send'&&(resource.humanConfirmed!==true
      ||resource.recipientVerified!==true))
    return deny('human-send-confirmation-required');
  return {allowed:true,reason:'verified-policy',role:principal.role};
}
