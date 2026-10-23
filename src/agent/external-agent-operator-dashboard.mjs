import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseExternalManifest } from './external-agent-assessment.mjs';
import {
  buildExternalControlReviewQueue, verifyExternalObservation
} from './external-agent-evidence-review.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const KB_ID = /^ARL-KB-(?:00[1-9]|0[1-9]\d|10[0-8])$/;
const SHA = /^[a-f0-9]{64}$/;

function demand(ok, message) {
  if (!ok) throw new Error('ARL external operator blocked: ' + message);
}

export function buildExternalOperatorDossier({ manifestRaw, roeRaw, observationRaw, syntheticDemo = false }) {
  // Offline verification is mandatory. This validates source consistency,
  // not independent origin, security posture or customer authorisation.
  const verified = verifyExternalObservation({ manifestRaw, roeRaw, observationRaw });
  const { manifest } = parseExternalManifest(manifestRaw);
  const queue = buildExternalControlReviewQueue({
    manifestRaw, roeRaw, observationRaw
  });
  const observation = JSON.parse(observationRaw);
  const roe = JSON.parse(roeRaw);

  demand(verified.consistency === 'consistent_only' &&
    verified.evidenceAccepted === false &&
    verified.securityVerdict === 'none' &&
    queue.candidateOnly === true &&
    queue.controlsTotal === 108 &&
    queue.controls.length === 108,
  'verified candidate-only source collection is required');

  return {
    schema: 'arl.external-agent-operator-dossier.v1',
    syntheticDemo: syntheticDemo === true,
    target: {
      name: manifest.target.name,
      declaredVersion: manifest.target.version,
      // URL withheld from the exported HTML (may contain private tenant path).
      endpointSha256: hash(manifest.target.endpoint),
      versionVerified: false
    },
    scope: {
      environment: roe.environment,
      syntheticDataOnly: roe.syntheticDataOnly,
      startUtc: roe.notBeforeUtc,
      endUtc: roe.notAfterUtc,
      ownerPermissionIndependentlyVerified: false
    },
    provenance: {
      collectionId: verified.collectionId,
      manifestSha256: observation.binding.manifestSha256,
      roeSha256: observation.binding.roeSha256,
      artifactSha256: verified.artifactSha256
    },
    collectedAtUtc: observation.observedAtUtc,
    probes: observation.observations.map(item => ({
      probeId: item.probeId,
      controlIds: [...item.controlIds],
      transport: item.transport,
      httpStatus: item.transport === 'http_response' ? item.httpStatus : null,
      responseSha256: item.transport === 'http_response' ? item.responseSha256 : null,
      responseBytes: item.transport === 'http_response' ? item.responseBytes : null,
      outcome: 'unreviewed',
      securityVerdict: 'none'
    })),
    controls: queue.controls,
    controlsTotal: 108,
    candidateControlCount: queue.mappedControlCount,
    candidateProbeCount: queue.candidateProbeCount,
    authoritativeSnapshotId: null,
    evidenceAccepted: false,
    confirmedFindings: 0,
    securityVerdict: 'none',
    deploymentDecision: 'hold',
    databaseModified: false,
    humanReviewRequired: true
  };
}

function assertReadOnly(d) {
  demand(d?.schema === 'arl.external-agent-operator-dossier.v1' &&
    [true, false].includes(d.syntheticDemo) &&
    d?.controlsTotal === 108 &&
    d.controls?.length === 108 &&
    d.target?.versionVerified === false &&
    d.scope?.ownerPermissionIndependentlyVerified === false &&
    d.authoritativeSnapshotId === null &&
    d.evidenceAccepted === false &&
    d.confirmedFindings === 0 &&
    d.securityVerdict === 'none' &&
    d.deploymentDecision === 'hold' &&
    d.databaseModified === false &&
    d.humanReviewRequired === true &&
    Array.isArray(d.probes) &&
    d.probes.length >= 1 && d.probes.length <= 5 &&
    d.candidateProbeCount === d.probes.length &&
    SHA.test(d.provenance?.manifestSha256 || '') &&
    SHA.test(d.provenance?.roeSha256 || '') &&
    SHA.test(d.provenance?.artifactSha256 || '') &&
    SHA.test(d.target?.endpointSha256 || ''),
  'dossier may not assert security authority or omit source binding');

  const ids = d.controls.map(c => c.controlId);
  demand(new Set(ids).size === 108 &&
    ids.every((id, idx) => id === 'ARL-KB-' + String(idx + 1).padStart(3, '0')),
  'all 108 ARL controls must be present in canonical order');
  const planned = new Map();
  for (const p of d.probes) {
    demand(/^[A-Z][A-Z0-9_-]{2,32}$/.test(p.probeId || '') &&
      !planned.has(p.probeId) &&
      p.outcome === 'unreviewed' &&
      p.securityVerdict === 'none' &&
      ['http_response','network_error_or_response_rejected'].includes(p.transport) &&
      Array.isArray(p.controlIds) &&
      p.controlIds.length >= 1 && p.controlIds.length <= 8 &&
      p.controlIds.every(id => KB_ID.test(id)) &&
      (p.transport !== 'http_response' ||
        (Number.isInteger(p.httpStatus) && p.httpStatus >= 100 &&
          p.httpStatus <= 599 && SHA.test(p.responseSha256 || '') &&
          Number.isInteger(p.responseBytes) && p.responseBytes >= 0 &&
          p.responseBytes <= 65536)),
    'invalid or promoted probe metadata');
    planned.set(p.probeId, p.controlIds);
  }

  let mapped = 0;
  for (const control of d.controls) {
    const expected = d.probes.filter(p => p.controlIds.includes(control.controlId))
      .map(p => p.probeId);
    demand(control.applicability === 'unknown' &&
      control.assessmentResult === 'not_assessed' &&
      control.evidenceAccepted === false &&
      control.humanReviewRequired === true &&
      control.candidateOnly === (expected.length > 0) &&
      JSON.stringify(control.candidateProbeIds) === JSON.stringify(expected),
    'control registry or candidate mapping is inconsistent');
    if (expected.length) mapped += 1;
  }
  demand(mapped === d.candidateControlCount, 'candidate count mismatch');
}

// No scripts, forms, network requests, images, external styles or browser storage.
// Inline CSS is permitted only by the exact SHA-256 Content Security Policy.
const css = [
  '*{box-sizing:border-box}',
  'body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f2f5f8;color:#182435}',
  'main{max-width:1080px;margin:0 auto;padding:22px}',
  'header{background:#15243b;color:white;padding:25px;border-radius:16px}',
  'header p{color:#dce6f2}h1{font-size:1.6rem;margin:5px 0}h2{font-size:1.2rem;margin:25px 0 8px}',
  'h3{font-size:1rem;margin:3px 0}code{overflow-wrap:anywhere;font-size:.85em}',
  '.notice{border-left:5px solid #ac741e;background:#fff7e8;padding:12px 16px;margin:15px 0}',
  '.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:16px 0}',
  '.metric,.panel{background:white;border:1px solid #d7e1eb;border-radius:12px;padding:15px}',
  '.metric b{display:block;font-size:1.7rem}.metric small,.muted{color:#53657a}',
  'table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #dce4ee;text-align:left;vertical-align:top}',
  'th{background:#e8eef6}tr:nth-child(even){background:#f7f9fb}',
  '.table-scroll{overflow:auto}.status{font-weight:700;color:#794c00}',
  'details{border:1px solid #d7e1eb;background:white;border-radius:12px;padding:12px;margin:14px 0}',
  'summary{cursor:pointer;font-weight:650}a{color:#15539e}',
  'ol li{margin:8px 0}footer{font-size:.85rem;color:#56677b;margin:24px 0}',
  '@media print{body{background:white}header{color:black;background:white;border:1px solid #aaa}header p{color:black}details{break-inside:avoid}}'
].join('');
const cssHash = crypto.createHash('sha256').update(css).digest('base64');

export function renderExternalOperatorHtml(dossier) {
  assertReadOnly(dossier);
  const d = dossier;
  const pending = d.controls.filter(c => c.candidateOnly);
  const controls = d.controls.filter(c => !c.candidateOnly);
  const probeRows = d.probes.map(p =>
    '<tr><td><code>' + htmlEscape(p.probeId) + '</code></td>' +
    '<td>' + htmlEscape(p.controlIds.join(', ')) + '</td>' +
    '<td>' + htmlEscape(p.transport === 'http_response'
      ? 'HTTP ' + p.httpStatus : 'Network error / rejected') + '</td>' +
    '<td>' + htmlEscape(p.transport === 'http_response'
      ? String(p.responseBytes) + ' bytes · SHA-256 ' + p.responseSha256
      : 'No accepted response') + '</td>' +
    '<td><span class="status">UNREVIEWED</span></td></tr>'
  ).join('');
  const mappedRows = pending.map(c =>
    '<tr><td><code>' + htmlEscape(c.controlId) + '</code></td>' +
    '<td>' + htmlEscape(c.candidateProbeIds.join(', ')) + '</td>' +
    '<td>Unknown</td><td>NOT ASSESSED</td><td>Not accepted</td></tr>'
  ).join('');
  const restRows = controls.map(c =>
    '<tr><td><code>' + htmlEscape(c.controlId) +
    '</code></td><td>None</td><td>Unknown</td><td>NOT ASSESSED</td></tr>'
  ).join('');
  const policy = 'default-src \'none\'; style-src \'sha256-' + cssHash +
    '\'; script-src \'none\'; connect-src \'none\'; img-src \'none\'; ' +
    'base-uri \'none\'; form-action \'none\'; object-src \'none\'; frame-src \'none\'';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + htmlEscape(policy) + '">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>ARL | External agent operator review</title>' +
    '<style>' + css + '</style></head><body><main>' +
    '<header><small>AGENTRISKLAYER · Private offline review</small>' +
    '<h1>External AI agent — evidence workbench</h1>' +
    '<p>Target: <strong>' + htmlEscape(d.target.name) +
    '</strong> · Declared release: <code>' +
    htmlEscape(d.target.declaredVersion) + '</code></p>' +
    '<p>Collection: <code>' + htmlEscape(d.provenance.collectionId) +
    '</code></p></header>' +
    (d.syntheticDemo ? '<div class="notice"><strong>SYNTHETIC DEMONSTRATION — NO REAL CUSTOMER OR ASSESSMENT DATA.</strong> The probes and responses on this page are simulated; nothing was sent to a real agent.</div>' : '') +
    '<div class="notice"><strong>Deployment HOLD · No security verdict.</strong> ' +
    'The endpoint, release and permission claims have NOT been independently verified. ' +
    'Response digests are candidates, not observed tool-side-effect proof. ' +
    'No finding, control PASS, or accreditation claim is made.</div>' +
    '<section class="metrics" aria-label="Candidate evidence summary">' +
    [['ARL controls', d.controlsTotal],
     ['Controls mapped to probes', d.candidateControlCount],
     ['Collected probes', d.candidateProbeCount],
     ['Accepted evidence', 0],
     ['Confirmed findings', 0]].map(([name,value]) =>
      '<div class="metric"><b>' + htmlEscape(value) +
      '</b><small>' + htmlEscape(name) + '</small></div>').join('') +
    '</section>' +
    '<section class="panel"><h2>Collection scope and provenance</h2>' +
    '<p>Environment: <strong>' + htmlEscape(d.scope.environment) +
    '</strong> · Synthetic-only: ' + htmlEscape(d.scope.syntheticDataOnly) +
    ' · Collection at ' + htmlEscape(d.collectedAtUtc) + '</p>' +
    '<p>Authorisation window (operator assertion only): ' +
    htmlEscape(d.scope.startUtc) + ' — ' +
    htmlEscape(d.scope.endUtc) + '</p>' +
    '<p class="muted">Target URL omitted for privacy; endpoint SHA-256: <code>' +
    htmlEscape(d.target.endpointSha256) + '</code></p>' +
    '<p>Manifest SHA-256: <code>' + htmlEscape(d.provenance.manifestSha256) +
    '</code><br>ROE SHA-256: <code>' + htmlEscape(d.provenance.roeSha256) +
    '</code><br>Observation SHA-256: <code>' +
    htmlEscape(d.provenance.artifactSha256) + '</code></p>' +
    '<p class="muted">Hash consistency is not a digital signature or independent ' +
    'confirmation that the target owner authorised testing.</p></section>' +
    '<h2>Probe observations — not security findings</h2>' +
    '<div class="panel table-scroll"><table><thead><tr><th>Probe</th>' +
    '<th>Candidate controls</th><th>Transport</th><th>Response digest</th>' +
    '<th>Decision</th></tr></thead><tbody>' + probeRows + '</tbody></table></div>' +
    '<h2>Human review priorities — ' + htmlEscape(pending.length) +
    ' controls with candidate probes</h2>' +
    '<p class="muted">Each candidate needs review of applicability, independent ' +
    'server-side action traces and side effects, exact target release, and scoped ' +
    'authorisation before any control conclusion.</p>' +
    '<div class="panel table-scroll"><table><thead><tr><th>Control</th><th>Probes</th>' +
    '<th>Applicability</th><th>Assessment</th><th>Evidence</th></tr></thead>' +
    '<tbody>' + mappedRows + '</tbody></table></div>' +
    '<details><summary>Show ' + htmlEscape(controls.length) +
    ' remaining ARL controls — not assessed</summary>' +
    '<div class="table-scroll"><table><thead><tr><th>Control</th>' +
    '<th>Candidate probes</th><th>Applicability</th><th>Assessment</th>' +
    '</tr></thead><tbody>' + restRows + '</tbody></table></div></details>' +
    '<section class="panel"><h2>Next steps for the accountable operator</h2>' +
    '<ol><li>Independently check the scope and written owner permission.</li>' +
    '<li>Obtain separately trusted evidence of the exact deployed release.</li>' +
    '<li>For each mapped control, obtain permitted before/after tool or resource-access logs.</li>' +
    '<li>Make separate, attributed human applicability and evidence decisions in ARL.</li>' +
    '<li>For any confirmed failure, link remediation and run exact-version retesting.</li>' +
    '<li>Only then produce a reviewed customer-facing report and deployment decision.</li></ol>' +
    '<p><strong>This file is read-only.</strong> It is not an authenticated ' +
    'ARL database session. No Control Intelligence records were changed when it was generated.</p></section>' +
    '<footer>ARL external candidate dossier. Recheck the current authoritative ' +
    'snapshot before entering findings or security decisions.</footer>' +
    '</main></body></html>';
  demand(Buffer.byteLength(html) < 512 * 1024, 'offline dossier exceeds 512 KiB');
  return html;
}

function privateDirectory(directory) {
  let current = directory;
  while (true) {
    const stat = fs.lstatSync(current);
    demand(!stat.isSymbolicLink(), 'symlinked directory ancestor rejected');
    if (current === directory) {
      demand(stat.isDirectory() && (stat.mode & 0o077) === 0,
        'output folder must be a private real directory (0700)');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function sameArtifact(file, html) {
  const stat = fs.lstatSync(file);
  demand(stat.isFile() && !stat.isSymbolicLink() &&
    (stat.mode & 0o077) === 0 && stat.size < 512 * 1024 &&
    fs.readFileSync(file, 'utf8') === html,
  'existing artifact is not an identical private regular file');
  return { filePath: file, status: 'unchanged', sha256: hash(html),
    bytes: Buffer.byteLength(html), databaseModified: false,
    securityVerdict: 'none', deploymentDecision: 'hold' };
}

export function writeExternalOperatorHtml({ dossier, outputDirectory }) {
  const html = renderExternalOperatorHtml(dossier);
  demand(typeof outputDirectory === 'string' && outputDirectory.trim(),
    'explicit private output directory required');
  const root = path.resolve(outputDirectory);
  demand(root !== path.parse(root).root, 'filesystem root is not an output directory');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  privateDirectory(root);
  const name = 'ARL-external-review-' + hash(html).slice(0,16) + '.html';
  const file = path.join(root, name);
  if (fs.existsSync(file)) return sameArtifact(file, html);
  const temp = path.join(root, '.' + name + '.' +
    crypto.randomBytes(12).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, html, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if (error?.code === 'EEXIST') return sameArtifact(file, html);
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
  return { filePath: file, status: 'created', sha256: hash(html),
    bytes: Buffer.byteLength(html), databaseModified: false,
    securityVerdict: 'none', deploymentDecision: 'hold' };
}
