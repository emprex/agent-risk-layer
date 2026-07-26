import crypto from 'node:crypto';
const PROVIDERS = new Set(['openai', 'anthropic', 'google', 'azure-openai', 'aws-bedrock', 'huggingface', 'local', 'other']);
const KINDS = new Set(['agent', 'model', 'mcp-server', 'tool', 'vector-store', 'gateway']);
export function discoverAiAssets(input = {}) {
    const documents = Array.isArray(input) ? input : [input];
    const assets = new Map();
    for (const document of documents)
        walk(document, '$', assets);
    return {
        schema: 'arl.asset-inventory.v1',
        generatedAt: new Date().toISOString(),
        assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
        summary: summarize([...assets.values()]),
    };
}
function walk(value, path, assets) {
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value))
        return value.forEach((item, index) => walk(item, `${path}[${index}]`, assets));
    const text = JSON.stringify(value).toLowerCase();
    const provider = detectProvider(text);
    const kind = detectKind(value, text);
    if (provider || kind) {
        const name = String(value.name || value.id || value.model || value.type || `${kind || 'ai-asset'}-${assets.size + 1}`).slice(0, 160);
        const canonical = `${kind || 'agent'}:${provider || 'other'}:${name}:${path}`;
        const id = `asset_${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 20)}`;
        assets.set(id, {
            id, name, kind: kind || 'agent', provider: provider || 'other', sourcePath: path,
            environment: normaliseEnvironment(value.environment || value.stage),
            internetExposed: Boolean(value.public || value.internetExposed || value.ingress),
            privileged: Boolean(value.admin || value.privileged || value.write || value.shell),
            model: String(value.model || '').slice(0, 160) || null,
        });
    }
    for (const [key, child] of Object.entries(value))
        walk(child, `${path}.${key}`, assets);
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
    if (value.model || text.includes('model_id'))
        return 'model';
    if (value.tools || value.instructions || value.systemPrompt)
        return 'agent';
    if (text.includes('vector_store') || text.includes('vectorstore'))
        return 'vector-store';
    return null;
}
function normaliseEnvironment(value) { const clean = String(value || 'unknown').toLowerCase(); return ['development', 'test', 'staging', 'production'].includes(clean) ? clean : 'unknown'; }
function summarize(assets) {
    return {
        total: assets.length,
        production: assets.filter((item) => item.environment === 'production').length,
        internetExposed: assets.filter((item) => item.internetExposed).length,
        privileged: assets.filter((item) => item.privileged).length,
        byKind: Object.fromEntries([...KINDS].map((kind) => [kind, assets.filter((item) => item.kind === kind).length])),
        byProvider: Object.fromEntries([...PROVIDERS].map((provider) => [provider, assets.filter((item) => item.provider === provider).length])),
    };
}
