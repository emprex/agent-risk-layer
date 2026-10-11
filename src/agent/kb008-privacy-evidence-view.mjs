import crypto from 'node:crypto';

const BEGIN='Requirement-specific deterministic observations:\n';
const END='\nThis collection does not assert that any canonical requirement is satisfied';
const REF=/^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):ARL-KB-008:[a-f0-9]{64}$/;
const HASH=/^[a-f0-9]{24}$/;

function items(value) {
  return (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []).slice(0,12);
}
function count(value) {
  return Number.isSafeInteger(value?.originalCount) ? value.originalCount :
    Array.isArray(value) ? value.length : 0;
}
function refs(value) {
  return items(value).map(x=>({
    basename:typeof x?.basename==='string' ? x.basename.slice(0,120) : null,
    pathHash:HASH.test(x?.pathHash || '') ? x.pathHash : null
  })).filter(x=>x.pathHash);
}
function hashes(value) {
  return items(value).map(x=>x?.destinationHash).filter(x=>HASH.test(x||''));
}
function incomplete(value) {
  return value?.incomplete===true || (Number.isInteger(value?.omittedCount) && value.omittedCount>0);
}
function collector(parsed,name) {
  return parsed.requirementObservations.find(x=>x?.collectors?.includes(name))?.observations?.[name] || {};
}

export function buildKb008PrivacyEvidenceView(detail,revision) {
  if (detail?.control?.id!=='ARL-KB-008' ||
      !/^[a-f0-9]{40}$/.test(revision||'') ||
      detail.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision!==revision ||
      !detail.systemSnapshot?.id || detail.testDefinition?.id!=='ARL-CHK-008' ||
      !detail.testDefinition?.digest) {
    throw new Error('KB-008 privacy evidence requires exact authoritative frozen target.');
  }
  const snapshotId=detail.systemSnapshot.id;
  const tests=new Map([...(detail.testHistory||[]),...(detail.tests||[])]
    .filter(x=>x?.id).map(x=>[x.id,x]));
  const evidence=new Map([...(detail.evidenceHistory||[]),...(detail.evidence||[])]
    .filter(x=>x?.id).map(x=>[x.id,x]));
  const records=[];
  for(const e of evidence.values()) {
    const t=tests.get(e.testExecutionId);
    const match=REF.exec(t?.inputReference||'');
    if (!match || match[1]!==revision ||
        e.controlId!=='ARL-KB-008' || t.controlId!=='ARL-KB-008' ||
        e.systemSnapshotId!==snapshotId || t.systemSnapshotId!==snapshotId ||
        e.sourceReference!==t.inputReference ||
        e.sourceType!=='arl_frozen_source_evidence_collection_v2' ||
        t.executionMethod!==e.sourceType ||
        t.checkId!=='ARL-CHK-008' || t.checkDigest!==detail.testDefinition.digest ||
        t.result!=='inconclusive' || e.retentionStatus!=='active') continue;
    const source=String(t.observedResult||'');
    const start=source.indexOf(BEGIN);
    const end=start<0?-1:source.indexOf(END,start+BEGIN.length);
    if(end<0)continue;
    let parsed;
    try {parsed=JSON.parse(source.slice(start+BEGIN.length,end));} catch {continue;}
    if(parsed?.schema!=='arl.deterministic-evidence-collection.v1' ||
        parsed.targetRevision!==revision || !Array.isArray(parsed.requirementObservations))continue;
    const data=collector(parsed,'data_and_capability_observation');
    const policy=collector(parsed,'policy_and_documentation');
    const identity=collector(parsed,'target_identity');
    const present=['target_identity','data_and_capability_observation','policy_and_documentation']
      .filter(name=>parsed.requirementObservations.some(x=>x?.collectors?.includes(name)));
    records.push({
      evidenceId:e.id,
      testExecutionId:t.id,
      referenceDigest:crypto.createHash('sha256').update(t.inputReference).digest('hex'),
      verificationState:e.verificationState||'unverified',
      observedCollectors:present,
      targetIdentityMetadataPresent:Object.keys(identity).length>0,
      technologyHints:items(data.observedTechnologies).filter(x=>typeof x==='string').map(x=>x.slice(0,80)),
      mcpToolReferences:refs(data.mcpAndToolReferenceFiles),
      mcpToolReferenceCount:count(data.mcpAndToolReferenceFiles),
      credentialReferenceFiles:refs(data.credentialReferenceFiles),
      destinationHashes:hashes(data.externalDestinationObservations),
      destinationObservationCount:count(data.externalDestinationObservations),
      privacyNoticeCandidateFiles:refs(policy.policyArtifacts),
      privacyNoticeCandidateCount:count(policy.policyArtifacts),
      policyDocumentCandidateFiles:refs(policy.architectureArtifacts),
      partialProjection:parsed.projection?.incomplete===true,
      incompleteMetadata:[data.mcpAndToolReferenceFiles,data.externalDestinationObservations,
        data.credentialReferenceFiles,policy.policyArtifacts].some(incomplete)
    });
  }
  return {
    schema:'arl.kb008.privacy-evidence-view.v1',
    controlId:'ARL-KB-008',systemSnapshotId:snapshotId,targetRevision:revision,
    observedEvidence:records,
    finding:'NOT_DETERMINED',
    limitations:'Static files, technology hints and destination hashes do not prove personal-data processing, lawful basis, privacy notice quality, retention or rights handling. Missing records do not prove absence. Human privacy review required.',
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true
  };
}
