import crypto from 'node:crypto';
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.ps1']);
export function verifyModelManifest(manifest = {}, trust = {}) {
    const findings = [];
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!manifest.modelId)
        findings.push(finding('ARL-MOD-001', 'critical', 'Model identity is missing.'));
    if (!manifest.source || !String(manifest.source).startsWith('https://'))
        findings.push(finding('ARL-MOD-002', 'high', 'Model source is not an HTTPS origin.'));
    if (!manifest.license)
        findings.push(finding('ARL-MOD-003', 'medium', 'Model licence is undeclared.'));
    if (!manifest.sha256 || !/^[a-f0-9]{64}$/i.test(manifest.sha256))
        findings.push(finding('ARL-MOD-004', 'critical', 'Model digest is missing or malformed.'));
    if (trust.expectedSha256 && !safeEqual(manifest.sha256, trust.expectedSha256))
        findings.push(finding('ARL-MOD-005', 'critical', 'Model digest does not match the approved digest.'));
    if (trust.allowedPublishers?.length && !trust.allowedPublishers.includes(manifest.publisher))
        findings.push(finding('ARL-MOD-006', 'critical', 'Model publisher is not allowlisted.'));
    if (files.some((file) => EXECUTABLE_EXTENSIONS.has(extension(file.name || ''))))
        findings.push(finding('ARL-MOD-007', 'critical', 'Model bundle contains executable content.'));
    if (files.some((file) => /(?:pickle|joblib|\.pt$|\.pth$)/i.test(file.name || '') && file.safeSerialization !== true)) {
        findings.push(finding('ARL-MOD-008', 'high', 'Model bundle uses unsafe or unverified serialisation.'));
    }
    return {
        schema: 'arl.model.verification.v1',
        decision: findings.some((f) => ['critical', 'high'].includes(f.severity)) ? 'quarantine' : 'allow',
        findings,
        evidence: {
            manifestDigest: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
            rawModelRetained: false,
            scannedFileCount: files.length,
        },
    };
}
function finding(ruleId, severity, message) { return { ruleId, severity, message }; }
function extension(name) { const i = String(name).lastIndexOf('.'); return i < 0 ? '' : String(name).slice(i).toLowerCase(); }
function safeEqual(a, b) {
    const left = Buffer.from(String(a || '').toLowerCase());
    const right = Buffer.from(String(b || '').toLowerCase());
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
