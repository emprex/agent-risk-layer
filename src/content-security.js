import crypto from 'node:crypto';
export const CONTENT_EVENT_SCHEMA = 'arl.content.event.v1';
const INPUT_RULES = [
    ['ARL-IN-001', 'high', /(?:ignore|disregard|override).{0,50}(?:previous|prior|system|developer).{0,30}(?:instruction|prompt|message)/is, 'Instruction hierarchy manipulation'],
    ['ARL-IN-002', 'critical', /(?:reveal|print|show|return|extract).{0,50}(?:system prompt|developer message|secret|api key|password|token)/is, 'Secret or hidden-instruction extraction'],
    ['ARL-IN-003', 'high', /(?:use|call|run|execute).{0,30}(?:shell|terminal|exec|tool).{0,60}(?:without|bypass|ignore).{0,30}(?:approval|permission|policy)/is, 'Tool-policy bypass'],
    ['ARL-IN-004', 'high', /(?:begin|start).{0,20}(?:system|developer|admin).{0,10}(?:message|instruction)|<\|(?:system|developer)\|>/is, 'Role or delimiter spoofing'],
    ['ARL-IN-005', 'high', /(?:base64|rot13|unicode|hex).{0,40}(?:decode|hidden|instruction|payload)/is, 'Obfuscated instruction'],
];
const OUTPUT_RULES = [
    ['ARL-OUT-001', 'critical', /(?:sk|pk|api|secret|token)[_-]?[a-z0-9]{12,}/i, 'Secret-like value in response'],
    ['ARL-OUT-002', 'critical', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, 'Private key in response'],
    ['ARL-OUT-003', 'high', /\b(?:\d[ -]*?){13,19}\b/, 'Payment-card-like value in response'],
    ['ARL-OUT-004', 'high', /(?:system prompt|developer message)\s*[:=]\s*.{20,}/is, 'Hidden instruction disclosure'],
    ['ARL-OUT-005', 'high', /(?:curl|wget).{0,100}(?:169\.254\.169\.254|localhost|127\.0\.0\.1)/is, 'Unsafe network instruction'],
];
const ENCODING_HINTS = [
    ['base64', /\b(?:[A-Za-z0-9+/]{24,}={0,2})\b/g],
    ['hex', /\b(?:[0-9a-f]{2}){12,}\b/gi],
];
const CONTEXT_RULES = [
    ['ARL-CTX-001', 'high', ['untrusted', 'tool', 'execute'], 'Untrusted content attempts to drive tool execution'],
    ['ARL-CTX-002', 'critical', ['credential', 'exfiltrate'], 'Credential exfiltration intent'],
    ['ARL-CTX-003', 'high', ['ignore', 'policy', 'action'], 'Policy override linked to an action'],
    ['ARL-CTX-004', 'high', ['hidden', 'instruction', 'follow'], 'Hidden-instruction execution intent'],
];
export function inspectContent({ direction, content, requestId, maxBytes = 131072 } = {}) {
    const started = performance.now();
    const originalText = flatten(content);
    const decodedLayers = decodeSuspiciousLayers(originalText);
    const text = [originalText, ...decodedLayers.map((item) => item.value)].join('\n');
    const bytes = Buffer.byteLength(text);
    const rules = direction === 'output' ? OUTPUT_RULES : INPUT_RULES;
    const findings = [];
    if (bytes > maxBytes)
        findings.push({ ruleId: 'ARL-CONTENT-SIZE', severity: 'critical', title: 'Content exceeds inspection limit' });
    for (const [ruleId, severity, pattern, title] of rules) {
        if (pattern.test(text) && !isBenignCredentialNavigation(ruleId, text))
            findings.push({ ruleId, severity, title });
    }
    const tokens = normaliseTokens(text);
    for (const [ruleId, severity, required, title] of CONTEXT_RULES) {
        if (required.every((token) => tokens.has(token)))
            findings.push({ ruleId, severity, title });
    }
    if (decodedLayers.length && findings.length)
        findings.push({ ruleId: 'ARL-ENC-001', severity: 'high', title: 'Encoded security-sensitive instruction' });
    const uniqueFindings = [...new Map(findings.map((finding) => [finding.ruleId, finding])).values()];
    return {
        schema: CONTENT_EVENT_SCHEMA,
        requestId: String(requestId || crypto.randomUUID()).slice(0, 100),
        timestamp: new Date().toISOString(),
        direction: direction === 'output' ? 'output' : 'input',
        decision: uniqueFindings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'deny' : 'allow',
        findings: uniqueFindings,
        evidence: {
            contentDigest: crypto.createHash('sha256').update(originalText).digest('hex'),
            contentBytes: Buffer.byteLength(originalText),
            decodedLayersInspected: decodedLayers.map((item) => item.encoding),
            rawContentRetained: false,
        },
        evaluationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
}
function isBenignCredentialNavigation(ruleId, text) {
    if (ruleId !== 'ARL-IN-002')
        return false;
    const value = String(text).toLowerCase();
    const navigation = /\b(?:where|how)\s+to\s+(?:find|open|manage|rotate|revoke)\b.{0,60}\b(?:token|api key|password)\s+(?:page|screen|settings|documentation)\b/s.test(value);
    const extraction = /\b(?:value|contents?|actual|full|raw|copy|print|reveal|exfiltrat|system prompt|developer message)\b/.test(value);
    return navigation && !extraction;
}
function normaliseTokens(text) {
    return new Set(String(text).normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '').split(/[^a-z0-9]+/).filter(Boolean));
}
function decodeSuspiciousLayers(text) {
    const decoded = [];
    for (const [encoding, pattern] of ENCODING_HINTS) {
        for (const match of String(text).matchAll(pattern)) {
            try {
                const value = Buffer.from(match[0], encoding === 'hex' ? 'hex' : 'base64').toString('utf8');
                if (value && printableRatio(value) > 0.8 && !decoded.some((item) => item.value === value))
                    decoded.push({ encoding, value: value.slice(0, 32768) });
            }
            catch { }
            if (decoded.length >= 5)
                return decoded;
        }
    }
    return decoded;
}
function printableRatio(value) {
    if (!value.length)
        return 0;
    return [...value].filter((char) => /[\x09\x0A\x0D\x20-\x7E]/.test(char)).length / value.length;
}
function flatten(value, out = [], depth = 0) {
    if (depth > 10 || out.length > 1000)
        return out.join('\n');
    if (typeof value === 'string')
        out.push(value.slice(0, 32768));
    else if (Array.isArray(value))
        value.forEach((v) => flatten(v, out, depth + 1));
    else if (value && typeof value === 'object')
        Object.values(value).forEach((v) => flatten(v, out, depth + 1));
    return out.join('\n');
}
