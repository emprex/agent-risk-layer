import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

export const EXTERNAL_MANIFEST_SCHEMA = 'arl.external-agent-manifest.v1';
export const EXTERNAL_ROE_SCHEMA = 'arl.external-agent-roe.v1';
export const MAX_PROBES = 5;
export const MAX_REQUEST_BYTES = 4096;
export const MAX_RESPONSE_BYTES = 65536;

const hash = (value) => createHash('sha256').update(value).digest('hex');
const validText = (value, max = 240) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function checkedEndpoint(endpoint) {
  requireCondition(validText(endpoint, 2048), 'Target endpoint is required.');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid target endpoint.'); }
  requireCondition(url.protocol === 'https:', 'External targets require HTTPS.');
  requireCondition(url.port === '' || url.port === '443', 'Only HTTPS port 443 is supported.');
  requireCondition(!url.username && !url.password && !url.search && !url.hash,
    'Endpoint credentials, query strings and fragments are forbidden.');
  const host = url.hostname.toLowerCase();
  requireCondition(isIP(host) === 0, 'Literal IP endpoints are forbidden.');
  requireCondition(host.length <= 253 && host.includes('.') && /^[a-z0-9.-]+$/.test(host) &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !host.split('.').some(label => label.startsWith('xn--')) &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(host),
    'Endpoint must use an ordinary public DNS hostname.');
  return url;
}

function isPublicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113 || a === 192 && b === 88 && c === 99 ||
    a === 169 && b === 255 || a === 255) return false;
  return true;
}

// DNS lookup is pinned to a vetted public IPv4 address for the actual TLS request.
export async function pinnedPublicAddress(url, dnsLookup = resolve4) {
  const addresses = await dnsLookup(url.hostname);
  requireCondition(Array.isArray(addresses) && addresses.length > 0 &&
    addresses.every(isPublicIPv4), 'Endpoint DNS did not resolve solely to public IPv4 addresses.');
  return addresses[0];
}

export function parseExternalManifest(raw) {
  requireCondition(typeof raw === 'string' && Buffer.byteLength(raw) <= 32768,
    'Manifest must be a UTF-8 JSON file of at most 32 KiB.');
  const m = JSON.parse(raw);
  requireCondition(m && !Array.isArray(m) && m.schema === EXTERNAL_MANIFEST_SCHEMA,
    'Invalid external manifest schema.');
  requireCondition(m.target && validText(m.target.name) &&
    validText(m.target.version, 128) && validText(m.target.owner),
    'Target name, owner and declared version (or unknown) are required.');
  const url = checkedEndpoint(m.target.endpoint);
  requireCondition(Array.isArray(m.probes) && m.probes.length >= 1 &&
    m.probes.length <= MAX_PROBES, 'Provide 1-' + MAX_PROBES + ' bounded probes.');
  const ids = new Set();
  for (const p of m.probes) {
    requireCondition(p && /^[A-Z][A-Z0-9_-]{2,32}$/.test(p.id || '') && !ids.has(p.id),
      'Probe IDs must be unique uppercase identifiers.');
    ids.add(p.id);
    requireCondition(Array.isArray(p.controlIds) && p.controlIds.length > 0 &&
      p.controlIds.length <= 8 && p.controlIds.every(x => /^ARL-KB-(?:00[1-9]|0[1-9]\d|10[0-8])$/.test(x)),
      'Each probe needs 1-8 valid ARL KB control IDs.');
    requireCondition(p.body && typeof p.body === 'object' && !Array.isArray(p.body) &&
      !('__proto__' in p.body && Object.hasOwn(p.body, '__proto__')) &&
      Buffer.byteLength(JSON.stringify(p.body)) <= MAX_REQUEST_BYTES,
      'Probe body must be a bounded JSON object (maximum 4 KiB).');
  }
  return { manifest: m, endpoint: url, sha256: hash(raw) };
}

function parseUtc(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(iso)) return NaN;
  return Date.parse(iso);
}

export function validateExternalRoe(raw, parsed, operator, acknowledged, nowMs = Date.now()) {
  requireCondition(acknowledged === true, 'Explicit --ack-authorised is required for live requests.');
  requireCondition(typeof raw === 'string' && Buffer.byteLength(raw) <= 16384,
    'Written-ROE reference file must be 16 KiB or less.');
  const roe = JSON.parse(raw);
  requireCondition(roe && !Array.isArray(roe) && roe.schema === EXTERNAL_ROE_SCHEMA,
    'Invalid rules-of-engagement schema.');
  requireCondition(roe.manifestSha256 === parsed.sha256 &&
    roe.targetEndpoint === parsed.manifest.target.endpoint,
    'ROE does not bind to the exact manifest bytes and target endpoint.');
  requireCondition(validText(operator) && roe.operator === operator &&
    validText(roe.owner) && roe.owner === parsed.manifest.target.owner &&
    validText(roe.authorisationReference, 500) &&
    roe.environment === 'isolated-staging' && roe.syntheticDataOnly === true,
    'ROE must identify matching operator/owner, owner authorisation reference and isolated synthetic staging scope.');
  requireCondition(Array.isArray(roe.allowedProbeIds) &&
    roe.allowedProbeIds.length === parsed.manifest.probes.length &&
    new Set(roe.allowedProbeIds).size === roe.allowedProbeIds.length &&
    parsed.manifest.probes.every(p => roe.allowedProbeIds.includes(p.id)),
    'ROE allowed probes must exactly match the manifest.');
  const from = parseUtc(roe.notBeforeUtc);
  const until = parseUtc(roe.notAfterUtc);
  requireCondition(Number.isFinite(from) && Number.isFinite(until) &&
    until > from && until - from <= 86400000 && nowMs >= from && nowMs <= until,
    'ROE testing window must be current and no longer than 24 hours.');
  return { roe, sha256: hash(raw), expiresAtMs: until };
}

export async function postBoundedJson({ endpoint, bodyBytes, dnsLookup = resolve4 }) {
  const url = checkedEndpoint(endpoint.href ?? endpoint);
  const address = await pinnedPublicAddress(url, dnsLookup);
  const timeout = AbortSignal.timeout(10000);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', signal: timeout, agent: false, maxHeaderSize: 8192,
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'Accept-Encoding': 'identity', 'Content-Length': Buffer.byteLength(bodyBytes),
        'User-Agent': 'AgentRiskLayer-ExternalAssessment/0.1'
      }
    }, res => {
      const chunks = [];
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Response exceeds 64 KiB maximum.'));
        } else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(bodyBytes);
  });
}

export async function runExternalAssessment({
  manifestRaw, roeRaw, operator, acknowledged = false,
  now = () => Date.now(), send = postBoundedJson
}) {
  const parsed = parseExternalManifest(manifestRaw);
  const validated = validateExternalRoe(roeRaw, parsed, operator, acknowledged, now());
  const results = [];
  for (const probe of parsed.manifest.probes) {
    requireCondition(now() <= validated.expiresAtMs, 'ROE expired during testing.');
    const bodyBytes = JSON.stringify(probe.body);
    const observation = {
      probeId: probe.id, controlIds: probe.controlIds,
      requestSha256: hash(bodyBytes), requestBytes: Buffer.byteLength(bodyBytes),
      observedAtUtc: new Date(now()).toISOString(),
      outcome: 'unreviewed', authority: 'none'
    };
    try {
      const received = await send({ endpoint: parsed.endpoint, bodyBytes });
      requireCondition(Number.isInteger(received.status) && received.status >= 100 && received.status <= 599 &&
        Buffer.isBuffer(received.body) && received.body.length <= MAX_RESPONSE_BYTES,
        'Invalid or oversized response.');
      observation.transport = 'http_response';
      observation.httpStatus = received.status;
      observation.responseSha256 = hash(received.body);
      observation.responseBytes = received.body.length;
      observation.redirectNotFollowed = received.status >= 300 && received.status <= 399;
    } catch {
      // Do not include exception text, URL tokens or raw response in reports.
      observation.transport = 'network_error_or_response_rejected';
    }
    results.push(observation);
  }
  return {
    schema: 'arl.external-agent-observation.v1',
    target: {
      type: 'external_black_box', name: parsed.manifest.target.name,
      endpoint: parsed.manifest.target.endpoint,
      declaredVersion: parsed.manifest.target.version,
      versionVerified: false
    },
    binding: { manifestSha256: parsed.sha256, roeSha256: validated.sha256 },
    operator, observedAtUtc: new Date(now()).toISOString(),
    observationCount: results.length, observations: results,
    securityVerdict: 'none', evidenceStatus: 'candidate_unreviewed',
    authorisationVerifiedIndependently: false,
    findingsConfirmed: 0, deploymentDecision: 'hold',
    limitations: [
      'Written authorisation reference is operator asserted and not independently validated.',
      'No raw agent output or secrets stored; response digests alone do not prove tool side effects.',
      'No automatic applicability, finding, severity, evidence acceptance or PASS decision.',
      'Not yet ingested into canonical PostgreSQL Control Intelligence or tied to its snapshot lineage.'
    ]
  };
}
