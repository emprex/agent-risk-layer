import { createHash } from 'node:crypto';
import {
  MAX_PROBES, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
  parseExternalManifest, validateExternalRoe
} from './external-agent-assessment.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const DIGEST = /^[a-f0-9]{64}$/;

function ensure(condition, reason) {
  if (!condition) throw new Error('External observation consistency rejected: ' + reason);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function sameArray(a, b) {
  return Array.isArray(a) && a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function boundedIso(value, start, end) {
  return typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) >= start && Date.parse(value) <= end;
}

export function verifyExternalObservation({
  manifestRaw, roeRaw, observationRaw
}) {
  const parsed = parseExternalManifest(manifestRaw);
  ensure(typeof roeRaw === 'string' && Buffer.byteLength(roeRaw) <= 16384,
    'ROE file missing or oversized');
  const roe = JSON.parse(roeRaw);
  ensure(roe && typeof roe === 'object', 'ROE reference malformed');
  // This is an OFFLINE consistency check of historical authorisation claims.
  // A time inside the declared ROE window checks its form without implying
  // that the ROE is currently valid or that the owner actually signed it.
  const midpoint = Date.parse(roe.notBeforeUtc) + 1;
  const gate = validateExternalRoe(
    roeRaw, parsed, roe.operator, true, midpoint
  );
  ensure(typeof observationRaw === 'string' &&
    Buffer.byteLength(observationRaw) <= 262144,
    'Observation file must be bounded to 256 KiB');
  const record = JSON.parse(observationRaw);
  const expectedTopKeys = [
    'schema', 'target', 'binding', 'operator', 'observedAtUtc',
    'observationCount', 'observations', 'securityVerdict',
    'evidenceStatus', 'authorisationVerifiedIndependently',
    'findingsConfirmed', 'deploymentDecision', 'limitations',
    'collectionId', 'artifactSha256'
  ];
  ensure(exactKeys(record, expectedTopKeys) &&
    record.schema === 'arl.external-agent-observation.v1' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.collectionId || ''),
    'Record schema, exact fields or collection ID');
  const { artifactSha256, ...payload } = record;
  ensure(DIGEST.test(artifactSha256 || '') &&
    digest(JSON.stringify(payload)) === artifactSha256,
    'Record content digest mismatch');
  ensure(exactKeys(record.target, [
    'type', 'name', 'endpoint', 'declaredVersion', 'versionVerified'
  ]) &&
    record.target.type === 'external_black_box' &&
    record.target.name === parsed.manifest.target.name &&
    record.target.endpoint === parsed.manifest.target.endpoint &&
    record.target.declaredVersion === parsed.manifest.target.version &&
    record.target.versionVerified === false,
    'Target name, endpoint or declared version differs from manifest');
  ensure(exactKeys(record.binding, ['manifestSha256', 'roeSha256']) &&
    record.binding.manifestSha256 === parsed.sha256 &&
    record.binding.roeSha256 === gate.sha256 &&
    record.operator === roe.operator,
    'Manifest, ROE or operator binding differs');
  ensure(record.securityVerdict === 'none' &&
    record.evidenceStatus === 'candidate_unreviewed' &&
    record.authorisationVerifiedIndependently === false &&
    record.findingsConfirmed === 0 &&
    record.deploymentDecision === 'hold' &&
    Array.isArray(record.limitations) && record.limitations.length === 4 &&
    record.limitations.every(x => typeof x === 'string' && x.length >= 20),
    'Evidence authority boundary changed');
  const from = Date.parse(roe.notBeforeUtc);
  const until = Date.parse(roe.notAfterUtc);
  ensure(boundedIso(record.observedAtUtc, from, until + 10000),
    'Collection completion time is outside ROE window');
  ensure(Array.isArray(record.observations) &&
    record.observationCount === parsed.manifest.probes.length &&
    record.observationCount <= MAX_PROBES &&
    record.observations.length === record.observationCount,
    'Observation count or probe coverage mismatch');
  for (let index = 0; index < record.observations.length; index++) {
    const observation = record.observations[index];
    const planned = parsed.manifest.probes[index];
    const requestBytes = JSON.stringify(planned.body);
    ensure(
      observation?.probeId === planned.id &&
      sameArray(observation.controlIds, planned.controlIds) &&
      observation.requestSha256 === digest(requestBytes) &&
      observation.requestBytes === Buffer.byteLength(requestBytes) &&
      observation.requestBytes <= MAX_REQUEST_BYTES &&
      boundedIso(observation.observedAtUtc, from, until) &&
      observation.outcome === 'unreviewed' &&
      observation.authority === 'none',
      'Probe ID, control mapping, request digest, time or authority mismatch'
    );
    if (observation.transport === 'http_response') {
      ensure(exactKeys(observation, [
        'probeId', 'controlIds', 'requestSha256', 'requestBytes',
        'observedAtUtc', 'outcome', 'authority', 'transport', 'httpStatus',
        'responseSha256', 'responseBytes', 'redirectNotFollowed'
      ]) &&
        Number.isInteger(observation.httpStatus) &&
        observation.httpStatus >= 100 && observation.httpStatus <= 599 &&
        DIGEST.test(observation.responseSha256 || '') &&
        Number.isInteger(observation.responseBytes) &&
        observation.responseBytes >= 0 &&
        observation.responseBytes <= MAX_RESPONSE_BYTES &&
        observation.redirectNotFollowed ===
          (observation.httpStatus >= 300 && observation.httpStatus <= 399),
        'HTTP observation bounds, response digest or redirect state'
      );
    } else {
      ensure(observation.transport === 'network_error_or_response_rejected' &&
        exactKeys(observation, [
          'probeId', 'controlIds', 'requestSha256', 'requestBytes',
          'observedAtUtc', 'outcome', 'authority', 'transport'
        ]), 'Network failure must not contain a fabricated HTTP result');
    }
  }
  return {
    schema: 'arl.external-agent-integrity-review.v1',
    consistency: 'consistent_only',
    collectionId: record.collectionId,
    artifactSha256: record.artifactSha256,
    target: record.target.name,
    declaredVersion: record.target.declaredVersion,
    versionVerified: false,
    exactManifestAndRoeBinding: true,
    observationsConsistent: record.observationCount,
    permissionsIndependentlyVerified: false,
    responsesIndependentlyAttested: false,
    sourceAuthenticityVerified: false,
    securityVerdict: 'none',
    evidenceAccepted: false,
    humanReviewRequired: true,
    warning: 'Matching hashes and schemas show internal consistency only. A party able to rewrite the inputs can recompute hashes. This is not a signature, authorised-access proof, agent behaviour verification or security finding.'
  };
}

export function buildExternalControlReviewQueue({
  manifestRaw, roeRaw, observationRaw
}) {
  const review = verifyExternalObservation({
    manifestRaw, roeRaw, observationRaw
  });
  const parsed = parseExternalManifest(manifestRaw);
  const mapped = new Map();
  for (const probe of parsed.manifest.probes) {
    for (const id of probe.controlIds) {
      if (!mapped.has(id)) mapped.set(id, []);
      mapped.get(id).push(probe.id);
    }
  }
  const controls = Array.from({ length: 108 }, (_, index) => {
    const id = 'ARL-KB-' + String(index + 1).padStart(3, '0');
    return {
      controlId: id,
      candidateProbeIds: mapped.get(id) || [],
      candidateOnly: mapped.has(id),
      applicability: 'unknown',
      evidenceAccepted: false,
      assessmentResult: 'not_assessed',
      humanReviewRequired: true
    };
  });
  return {
    schema: 'arl.external-agent-control-review-queue.v1',
    controlProfile: 'ARL-RKA-1.2.0',
    collectionId: review.collectionId,
    artifactSha256: review.artifactSha256,
    candidateProbeCount: review.observationsConsistent,
    mappedControlCount: mapped.size,
    controlsTotal: 108,
    controls,
    integrity: review.consistency,
    candidateOnly: true,
    authoritativeSnapshotId: null,
    databaseModified: false,
    securityVerdict: 'none',
    confirmedFindings: 0,
    deploymentDecision: 'hold',
    humanReviewRequired: true,
    warning: 'All 108 controls remain NOT ASSESSED until evidence, applicability and observed outcomes are independently reviewed and bound to an authoritative assessment.'
  };
}
