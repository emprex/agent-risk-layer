import crypto from 'node:crypto';
export const RUNTIME_POLICY_SCHEMA = 'arl.runtime.policy.v1';
export const RUNTIME_EVENT_SCHEMA = 'arl.runtime.event.v1';
const DEFAULT_DENIED_TOOLS = ['shell', 'exec', 'terminal', 'delete', 'drop_database'];
const SECRET_KEYS = /(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|authorization)/i;
const WRITE_ACTION = /(?:write|create|update|delete|remove|send|publish|deploy|execute|exec|shell|transfer|payment)/i;
export function compileRuntimePolicy(input = {}) {
    const policy = {
        schema: RUNTIME_POLICY_SCHEMA,
        version: clean(input.version || '1', 40),
        mode: input.mode === 'monitor' ? 'monitor' : 'enforce',
        failMode: 'closed',
        allowedTools: list(input.allowedTools, 100),
        deniedTools: list(input.deniedTools?.length ? input.deniedTools : DEFAULT_DENIED_TOOLS, 100),
        allowedHosts: list(input.allowedHosts, 100).map(normaliseHost).filter(Boolean),
        deniedPathPatterns: list(input.deniedPathPatterns?.length ? input.deniedPathPatterns : [
            '..', '/etc/', '/proc/', '/root/', '.ssh/', '.env', 'credentials',
        ], 100),
        requireApprovalFor: list(input.requireApprovalFor?.length ? input.requireApprovalFor : [
            'write', 'delete', 'send', 'deploy', 'execute', 'payment', 'transfer',
        ], 100),
        maxArgumentBytes: clamp(input.maxArgumentBytes, 256, 262144, 32768),
        blockSecretLikeValues: input.blockSecretLikeValues !== false,
        inspectInput: input.inspectInput !== false,
        inspectOutput: input.inspectOutput !== false,
        maxResponseBytes: clamp(input.maxResponseBytes, 256, 1048576, 131072),
    };
    if (!policy.version)
        throw new Error('Policy version is required.');
    return Object.freeze(policy);
}
export function evaluateRuntimeAction(action, policyInput = {}) {
    const policy = policyInput.schema === RUNTIME_POLICY_SCHEMA ? policyInput : compileRuntimePolicy(policyInput);
    const started = performance.now();
    const requestId = clean(action?.requestId || crypto.randomUUID(), 100);
    const tool = clean(action?.tool, 160).toLowerCase();
    const args = action?.arguments;
    const context = action?.context && typeof action.context === 'object' ? action.context : {};
    const rules = [];
    if (!tool)
        rules.push(block('ARL-RUN-001', 'Tool identity is missing.'));
    if (policy.deniedTools.some((value) => matchesTool(tool, value)))
        rules.push(block('ARL-RUN-002', `Tool "${tool}" is denied by policy.`));
    if (policy.allowedTools.length && !policy.allowedTools.some((value) => matchesTool(tool, value)))
        rules.push(block('ARL-RUN-003', `Tool "${tool}" is not allowlisted.`));
    let serialised = '';
    try {
        serialised = JSON.stringify(args ?? {});
    }
    catch {
        rules.push(block('ARL-RUN-004', 'Tool arguments cannot be safely serialised.'));
    }
    if (Buffer.byteLength(serialised) > policy.maxArgumentBytes)
        rules.push(block('ARL-RUN-005', 'Tool arguments exceed the configured size limit.'));
    const strings = collectStrings(args);
    for (const pattern of policy.deniedPathPatterns) {
        if (strings.some((value) => value.toLowerCase().includes(pattern.toLowerCase()))) {
            rules.push(block('ARL-RUN-006', `Arguments match denied path pattern "${pattern}".`));
            break;
        }
    }
    const hosts = extractHosts(strings);
    if (hosts.length && policy.allowedHosts.length) {
        const denied = hosts.find((host) => !policy.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)));
        if (denied)
            rules.push(block('ARL-RUN-007', `Network destination "${denied}" is not allowlisted.`));
    }
    if (policy.blockSecretLikeValues && containsSecretLikeMaterial(args)) {
        rules.push(block('ARL-RUN-008', 'Arguments contain secret-like material.'));
    }
    const needsApproval = policy.requireApprovalFor.some((term) => tool.includes(term)) || WRITE_ACTION.test(String(context.action || ''));
    if (needsApproval && context.humanApproved !== true)
        rules.push(block('ARL-RUN-009', 'This action requires explicit human approval.'));
    if (context.environment === 'production' && context.productionApproved !== true)
        rules.push(block('ARL-RUN-010', 'Production action lacks explicit production approval.'));
    const blocked = rules.length > 0;
    const enforced = policy.mode === 'enforce';
    return {
        schema: RUNTIME_EVENT_SCHEMA,
        requestId,
        timestamp: new Date().toISOString(),
        decision: blocked && enforced ? 'deny' : 'allow',
        observedDecision: blocked ? 'would-deny' : 'allow',
        policy: { schema: policy.schema, version: policy.version, mode: policy.mode, failMode: policy.failMode },
        reasons: rules,
        evidence: {
            tool: tool || 'unknown',
            argumentDigest: crypto.createHash('sha256').update(serialised).digest('hex'),
            argumentBytes: Buffer.byteLength(serialised),
            rawArgumentsRetained: false,
            destinations: hosts,
        },
        evaluationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
}
function block(ruleId, message) { return { ruleId, severity: 'critical', message }; }
function matchesTool(tool, pattern) { return tool === pattern || tool.startsWith(`${pattern}.`) || tool.endsWith(`.${pattern}`); }
function clean(value, max) { return String(value || '').trim().slice(0, max); }
function list(value, max) { return Array.isArray(value) ? [...new Set(value.map((item) => clean(item, 200).toLowerCase()).filter(Boolean))].slice(0, max) : []; }
function clamp(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback; }
function normaliseHost(value) {
    try {
        return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
    }
    catch {
        return '';
    }
}
function collectStrings(value, output = [], depth = 0) {
    if (depth > 8 || output.length > 500)
        return output;
    if (typeof value === 'string')
        output.push(value.slice(0, 8192));
    else if (Array.isArray(value))
        value.forEach((item) => collectStrings(item, output, depth + 1));
    else if (value && typeof value === 'object')
        Object.entries(value).forEach(([key, item]) => { output.push(String(key)); collectStrings(item, output, depth + 1); });
    return output;
}
function extractHosts(strings) {
    const hosts = [];
    for (const value of strings) {
        for (const match of value.matchAll(/https?:\/\/([^/\s"'<>]+)/gi)) {
            try {
                hosts.push(new URL(`https://${match[1]}`).hostname.toLowerCase());
            }
            catch { }
        }
    }
    return [...new Set(hosts)];
}
function containsSecretLikeMaterial(value, depth = 0) {
    if (depth > 8 || !value || typeof value !== 'object')
        return false;
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEYS.test(key) && typeof item === 'string' && item.length >= 8)
            return true;
        if (containsSecretLikeMaterial(item, depth + 1))
            return true;
    }
    return false;
}
