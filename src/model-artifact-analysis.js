import crypto from 'node:crypto';
const EXECUTABLE_MARKERS = [/\bc__builtin__\b/i, /\bGLOBAL\b/, /\bREDUCE\b/, /subprocess/i, /os\.system/i, /eval\s*\(/i];
export function analyseModelArtifact({ name = 'model.bin', bytes, expectedSha256 = '', maxTensorBytes = 8 * 1024 ** 3 }) {
    if (!Buffer.isBuffer(bytes))
        throw new Error('Model artifact bytes are required.');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const findings = [];
    if (expectedSha256 && !safeEqualHex(sha256, expectedSha256))
        findings.push(finding('critical', 'MODEL-DIGEST-MISMATCH', 'Artifact digest does not match the trusted manifest.'));
    const extension = String(name).toLowerCase().split('.').pop();
    let metadata = { format: extension || 'unknown', tensors: 0, declaredBytes: 0 };
    if (extension === 'safetensors')
        metadata = parseSafetensors(bytes, maxTensorBytes, findings);
    else if (['pkl', 'pickle', 'pt', 'pth', 'bin'].includes(extension)) {
        const sample = bytes.subarray(0, Math.min(bytes.length, 2 * 1024 ** 2)).toString('latin1');
        const markers = EXECUTABLE_MARKERS.filter((pattern) => pattern.test(sample)).map(String);
        if (markers.length)
            findings.push(finding('critical', 'MODEL-EXECUTABLE-SERIALIZATION', 'Potential executable deserialization instructions detected.', { markers }));
        else
            findings.push(finding('medium', 'MODEL-UNSAFE-FORMAT', 'Artifact uses a serialization format that may execute code when loaded.'));
    }
    if (bytes.length === 0)
        findings.push(finding('high', 'MODEL-EMPTY-ARTIFACT', 'Artifact is empty.'));
    return {
        schema: 'arl.model-analysis.v1', name: String(name).slice(0, 200), sha256, size: bytes.length, metadata, findings,
        quarantine: findings.some((item) => ['critical', 'high'].includes(item.severity)),
        decision: findings.some((item) => item.severity === 'critical') ? 'REJECT' : findings.length ? 'REVIEW' : 'ACCEPT',
    };
}
function parseSafetensors(bytes, maxTensorBytes, findings) {
    if (bytes.length < 8) {
        findings.push(finding('critical', 'MODEL-TRUNCATED', 'SafeTensors header is missing.'));
        return { format: 'safetensors', tensors: 0, declaredBytes: 0 };
    }
    const headerLength = Number(bytes.readBigUInt64LE(0));
    if (!Number.isSafeInteger(headerLength) || headerLength <= 1 || headerLength > 100 * 1024 ** 2 || headerLength + 8 > bytes.length) {
        findings.push(finding('critical', 'MODEL-INVALID-HEADER', 'SafeTensors header length is invalid.'));
        return { format: 'safetensors', tensors: 0, declaredBytes: 0 };
    }
    try {
        const header = JSON.parse(bytes.subarray(8, 8 + headerLength).toString('utf8'));
        const tensors = Object.entries(header).filter(([key]) => key !== '__metadata__');
        let declaredBytes = 0;
        for (const [tensorName, tensor] of tensors) {
            const [start, end] = tensor.data_offsets || [];
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
                findings.push(finding('critical', 'MODEL-TENSOR-OFFSET', `Tensor ${tensorName} has invalid offsets.`));
            else {
                declaredBytes = Math.max(declaredBytes, end);
                if (end - start > maxTensorBytes)
                    findings.push(finding('high', 'MODEL-TENSOR-SIZE', `Tensor ${tensorName} exceeds the configured size boundary.`));
            }
        }
        if (declaredBytes > bytes.length - 8 - headerLength)
            findings.push(finding('critical', 'MODEL-TENSOR-TRUNCATED', 'Declared tensor data exceeds artifact length.'));
        return { format: 'safetensors', tensors: tensors.length, declaredBytes, metadata: header.__metadata__ || {} };
    }
    catch {
        findings.push(finding('critical', 'MODEL-INVALID-JSON', 'SafeTensors metadata is not valid JSON.'));
        return { format: 'safetensors', tensors: 0, declaredBytes: 0 };
    }
}
function finding(severity, ruleId, title, evidence = {}) { return { severity, ruleId, title, evidence }; }
function safeEqualHex(left, right) {
    try {
        const a = Buffer.from(left, 'hex');
        const b = Buffer.from(String(right), 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
