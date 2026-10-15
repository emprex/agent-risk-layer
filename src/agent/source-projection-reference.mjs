import crypto from 'node:crypto';
import {CURRENT_SOURCE_PROJECTION} from './source-projection-selection.mjs';

const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const CONTROL=/^ARL-KB-\d{3}$/;

// Append-only and idempotent: collection content and CURRENT authoritative
// check digest determine the versioned input reference, not a wall clock,
// operator request, or a mutable inspector summary.
export function buildSourceProjectionRefreshReference({targetRevision,controlId,
 checkDigest,collection}){
 if(!SHA40.test(targetRevision||'')||!CONTROL.test(controlId||'')||
    !SHA64.test(checkDigest||'')||
    collection?.schema!=='arl.deterministic-evidence-collection.v1'||
    collection?.sourceProjectionRevision!==CURRENT_SOURCE_PROJECTION||
    collection.targetRevision!==targetRevision||
    !Array.isArray(collection.requirementObservations))
  throw new Error('Projection refresh requires versioned same-target collection and exact authoritative check digest.');
 const collectionSha256=crypto.createHash('sha256')
  .update(JSON.stringify(collection)).digest('hex');
 const refreshDigest=crypto.createHash('sha256')
  .update(JSON.stringify({
   purpose:CURRENT_SOURCE_PROJECTION,targetRevision,controlId,
   currentCheckDigest:checkDigest,collectionSha256
  })).digest('hex');
 return 'arl_frozen_source_evidence_collection_v2:'+
  targetRevision+':'+controlId+':'+refreshDigest;
}
