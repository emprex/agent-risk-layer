// ENKYRON Owner mailbox assignments (configuration only, not authentication).
// Applied solely to the verified Owner principal by the trusted server boundary.
// This file does not activate login, connect Resend or grant Qt IPC privileges.
import {OWNER_LOGIN, OWNER_ROLE} from './enkyron-owner-enrollment.mjs';
import {authoriseEnkyronOperation} from './enkyron-access-policy.mjs';

export const OWNER_MAILBOXES=Object.freeze([
  Object.freeze({
    key:'direction',
    address:'guillaume.strohecker@agentrisklayer.com',
    label:'Direction',
    permissions:Object.freeze(['read','reply','send','link_ticket','link_company'])
  }),
  Object.freeze({
    key:'support',
    address:'support@agentrisklayer.com',
    label:'Support',
    permissions:Object.freeze(['read','reply','send','link_ticket','link_company'])
  })
]);

const ROLES=Object.freeze({
  login:OWNER_LOGIN,
  role:OWNER_ROLE,
  position:'CEO',
  organisation:'AGENTRISKLAYER LTD',
});
const PERMITTED_ACTIONS=new Set(['read','reply','send','link_ticket','link_company']);
const MAIL_OPERATIONS=Object.freeze({read:'email:read',reply:'email:send',send:'email:send'});

export function ownerMailAccessCard(profile={}){
  // UI account card is a declaration of provisioned policy, NOT a live authorisation grant.
  const name=typeof profile.display_name==='string'&&profile.display_name.trim()
    ?profile.display_name.trim().slice(0,120):'Guillaume';
  return {
    ...ROLES,
    name,
    mailboxes:OWNER_MAILBOXES.map(({key,address,label,permissions})=>({
      key,address,label,permissions:[...permissions],
    })),
    connection:'not_connected',
    account_status:'not_authenticated',
    notice:'Configured mailbox policy only. Owner sign-in and Resend access are not active.',
  };
}

export function ownerMailboxPermission(principal,organizationId,mailboxKey,action){
  if(!PERMITTED_ACTIONS.has(action))return false;
  const mailbox=OWNER_MAILBOXES.find(m=>m.key===mailboxKey);
  if(!mailbox||!mailbox.permissions.includes(action))return false;
  // Do not accept only a self-declared job title, Linux username, or role.
  // A caller-constructed principal is not trustworthy; only a trusted auth
  // service may call this function with an already verified principal.
  if(principal?.loginName!==OWNER_LOGIN||principal?.role!==OWNER_ROLE)return false;
  const policyAction=MAIL_OPERATIONS[action];
  if(!policyAction)return false; // ticket/company linking uses separate CRM policy
  return authoriseEnkyronOperation(principal,policyAction,{
    organizationId,
    ...(policyAction==='email:send'
      ?{humanConfirmed:true,recipientVerified:true}:{}),
  }).allowed;
}
