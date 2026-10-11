import crypto from 'node:crypto';

const BEGIN = 'Requirement-specific deterministic observations:\n';
const END = '\nThis collection does not assert that any canonical requirement is satisfied';
const REF = /^arl_frozen_source_evidence_collection_v2:([a-f0-9]{40}):ARL-KB-007:[a-f0-9]{64}$/;

function values(value, limit = 20) {
  const items = Array.isArray(value) ? value : value?.items;
  return Array.isArray(items) ? items.slice(0, limit) : [];
}
function count(value) {
  return Array.isArray(value) ? value.length : Number.isInteger(value?.originalCount) ? value.originalCount : 0;
}
function limited(value) {
  return value?.incomplete === true || value?.omittedCount > 0;
}
function rows(value) {
  return values(value).map(item => ({
    pathHash: /^[a-f0-9]{24}$/.test(item?.pathHash || '') ? item.pathHash : null,
    basename: typeof item?.basename === 'string' ? item.basename.slice(0, 120) : null
  }));
}

export function buildKb007ProviderEvidenceView(detail, revision) {
  if (detail?.control?.id !== 'ARL-KB-007' || !/^[a-f0-9]{40}$/.test(revision || '') ||
      detail.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== revision ||
      !detail.systemSnapshot?.id || !detail.testDefinition?.digest) {
    throw new Error('KB-007 read-only provider view requires authoritative exact frozen binding.');
  }
  const tests = [...new Map([...(detail.tests || []),...(detail.testHistory || [])]
    .filter(t => t?.id).map(t => [t.id,t])).values()];
  const evidence = [...new Map([...(detail.evidence || []),...(detail.evidenceHistory || [])]
    .filter(e => e?.id).map(e => [e.id,e])).values()];
  const candidates = [];
  for (const item of evidence) {
    const test = tests.find(t => t.id === item.testExecutionId);
    const ref = REF.exec(test?.inputReference || '');
    if (!test || !ref || ref[1] !== revision ||
        item.controlId !== 'ARL-KB-007' || test.controlId !== 'ARL-KB-007' ||
        item.systemSnapshotId !== detail.systemSnapshot.id ||
        test.systemSnapshotId !== detail.systemSnapshot.id ||
        item.retentionStatus !== 'active' ||
        item.sourceType !== 'arl_frozen_source_evidence_collection_v2' ||
        item.sourceReference !== test.inputReference ||
        test.executionMethod !== item.sourceType || test.result !== 'inconclusive' ||
        test.checkId !== detail.testDefinition.id ||
        test.checkDigest !== detail.testDefinition.digest) continue;
    const source = String(test.observedResult || '');
    const begin = source.indexOf(BEGIN);
    if (begin < 0) continue;
    const end = source.indexOf(END,begin + BEGIN.length);
    if (end < 0) continue;
    let parsed;
    try {parsed = JSON.parse(source.slice(begin + BEGIN.length,end));} catch {continue;}
    if (parsed?.schema !== 'arl.deterministic-evidence-collection.v1' ||
        parsed.targetRevision !== revision || !Array.isArray(parsed.requirementObservations)) continue;
    const inventory = parsed.requirementObservations.find(x =>
      x.collectors?.includes('architecture_and_inventory'))?.observations?.architecture_and_inventory || {};
    const network = parsed.requirementObservations.find(x =>
      x.collectors?.includes('source_and_configuration'))?.observations?.source_and_configuration || {};
    const pkg = values(inventory.providerPackageCandidates).filter(s=>typeof s === 'string')
      .map(s=>s.slice(0, 120));
    const destinations = values(inventory.externalDestinationObservations).map(x=>x?.destinationHash)
      .filter(h=>/^[a-f0-9]{24}$/.test(h||''));
    candidates.push({
      evidenceId:item.id,
      testExecutionId:test.id,
      sourceReferenceSha256:crypto.createHash('sha256').update(test.inputReference).digest('hex'),
      verificationState:item.verificationState || 'unverified',
      partialProjection:parsed.projection?.incomplete === true,
      projectionDigest:parsed.projection?.fullCollectionSha256 || null,
      packages:pkg,
      providerPackageCount:count(inventory.providerPackageCandidates),
      destinationHashes:destinations,
      destinationCount:inventory.externalDestinationObservationCount ?? count(inventory.externalDestinationObservations),
      mcpToolReferences:rows(inventory.mcpAndToolReferenceFiles),
      mcpToolReferenceCount:count(inventory.mcpAndToolReferenceFiles),
      configReferences:rows(network.configurationArtifacts),
      configReferenceCount:count(network.configurationArtifacts),
      sourceCoverage:inventory.discoveryCoverage || null,
      incompleteArrays:limited(inventory.mcpAndToolReferenceFiles) ||
        limited(inventory.providerPackageCandidates) ||
        limited(inventory.externalDestinationObservations)
    });
  }
  return {
    schema:'arl.kb007.provider-evidence-view.v1',
    controlId:'ARL-KB-007',
    systemSnapshotId:detail.systemSnapshot.id,
    targetRevision:revision,
    observedEvidence:candidates,
    note:'Candidate metadata only. SDK names, endpoint hashes and file references do not establish active providers, complete inventory, approval, or security.',
    humanReviewRequired:true,
    securityStateChanged:false,
    deploymentDecisionWritten:false
  };
}
