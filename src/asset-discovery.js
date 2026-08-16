import crypto from 'node:crypto';
const PROVIDERS = new Set(['openai', 'anthropic', 'google', 'azure-openai', 'aws-bedrock', 'huggingface', 'local', 'other']);
const KINDS = new Set(['agent', 'model', 'mcp-server', 'tool', 'vector-store', 'gateway']);
const EVIDENCE_STATUS = Object.freeze({ TRUE: 'known-true', FALSE: 'known-false', UNKNOWN: 'unknown' });

export function discoverAiAssets(input = {}) {
    const documents = Array.isArray(input) ? input : [input];
    const assets = new Map();
    for (const document of documents)
        walk(document, '$', assets, 'unknown');
    return {
        schema: 'arl.asset-inventory.v2',
        generatedAt: new Date().toISOString(),
        assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
        summary: summarize([...assets.values()]),
    };
}
function walk(value, path, assets, inheritedEnvironment) {
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value))
        return value.forEach((item, index) => walk(item, `${path}[${index}]`, assets, inheritedEnvironment));
    const environment = normaliseEnvironment(value.environment || value.stage || inheritedEnvironment);
    const text = JSON.stringify(value).toLowerCase();
    const provider = detectProvider(text);
    const kind = detectKind(value, text);
    if (provider || kind) {
        const name = String(value.name || value.id || value.model || value.type || `${kind || 'ai-asset'}-${assets.size + 1}`).slice(0, 160);
        const canonical = `${kind || 'agent'}:${provider || 'other'}:${name}:${path}`;
        const id = `asset_${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 20)}`;
        const exposure = evidenceBoolean(value, ['public', 'internetExposed', 'ingress']);
        const privilege = evidenceBoolean(value, ['admin', 'privileged', 'write', 'shell']);
        assets.set(id, {
            id, name, kind: kind || 'agent', provider: provider || 'other', sourcePath: path,
            environment,
            internetExposed: exposure.value,
            internetExposureStatus: exposure.status,
            privileged: privilege.value,
            privilegeStatus: privilege.status,
            model: String(value.model || '').slice(0, 160) || null,
        });
    }
    for (const [key, child] of Object.entries(value))
        walk(child, `${path}.${key}`, assets, environment);
}
function detectProvider(text) {
    const aliases = [['azure-openai', ['azure_openai', 'azure-openai', 'openai.azure']], ['aws-bedrock', ['bedrock', 'amazon.titan']], ['huggingface', ['huggingface', 'transformers']], ['anthropic', ['anthropic', 'claude']], ['openai', ['openai', 'gpt-']], ['google', ['vertexai', 'vertex_ai', 'gemini']], ['local', ['ollama', 'llama.cpp', 'localhost']]];
    return aliases.find(([, markers]) => markers.some((marker) => text.includes(marker)))?.[0] || null;
}
function detectKind(value, text) {
    const explicit = String(value.kind || value.type || '').toLowerCase();
    if (KINDS.has(explicit))
        return explicit;
    if (text.includes('mcpserver') || text.includes('mcp-server') || text.includes('"mcp"'))
        return 'mcp-server';
    if (value.tools || value.instructions || value.systemPrompt)
        return 'agent';
    if (value.model || text.includes('model_id'))
        return 'model';
    if (text.includes('vector_store') || text.includes('vectorstore'))
        return 'vector-store';
    return null;
}
function evidenceBoolean(value, keys) {
    const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    if (!present.length)
        return { value: null, status: EVIDENCE_STATUS.UNKNOWN };
    const resolved = present.map((key) => normaliseEvidenceBoolean(value[key])).filter((item) => item !== null);
    if (!resolved.length)
        return { value: null, status: EVIDENCE_STATUS.UNKNOWN };
    const positive = resolved.some(Boolean);
    return { value: positive, status: positive ? EVIDENCE_STATUS.TRUE : EVIDENCE_STATUS.FALSE };
}
function normaliseEvidenceBoolean(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value !== 0;
    if (typeof value === 'string') {
        const clean = value.trim().toLowerCase();
        if (!clean)
            return null;
        if (['false', 'no', 'none', 'disabled', 'private', 'internal', '0'].includes(clean))
            return false;
        if (['true', 'yes', 'enabled', 'public', 'external', '1'].includes(clean))
            return true;
        return null;
    }
    if (Array.isArray(value))
        return value.length ? true : false;
    if (value && typeof value === 'object')
        return Object.keys(value).length ? true : null;
    return null;
}
function normaliseEnvironment(value) { const clean = String(value || 'unknown').toLowerCase(); return ['development', 'test', 'staging', 'production'].includes(clean) ? clean : 'unknown'; }
function summarize(assets) {
    return {
        total: assets.length,
        production: assets.filter((item) => item.environment === 'production').length,
        internetExposed: assets.filter((item) => item.internetExposed === true).length,
        internetNotExposed: assets.filter((item) => item.internetExposureStatus === EVIDENCE_STATUS.FALSE).length,
        internetExposureUnknown: assets.filter((item) => item.internetExposureStatus === EVIDENCE_STATUS.UNKNOWN).length,
        privileged: assets.filter((item) => item.privileged === true).length,
        notPrivileged: assets.filter((item) => item.privilegeStatus === EVIDENCE_STATUS.FALSE).length,
        privilegeUnknown: assets.filter((item) => item.privilegeStatus === EVIDENCE_STATUS.UNKNOWN).length,
        evidenceComplete: assets.every((item) => item.internetExposureStatus !== EVIDENCE_STATUS.UNKNOWN && item.privilegeStatus !== EVIDENCE_STATUS.UNKNOWN),
        byKind: Object.fromEntries([...KINDS].map((kind) => [kind, assets.filter((item) => item.kind === kind).length])),
        byProvider: Object.fromEntries([...PROVIDERS].map((provider) => [provider, assets.filter((item) => item.provider === provider).length])),
    };
}
