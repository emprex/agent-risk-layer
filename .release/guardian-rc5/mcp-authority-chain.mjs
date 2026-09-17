import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 15_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 24_000_000;
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.pytest_cache', '__pycache__', '.venv', 'venv',
  'target', 'out', '.idea', '.vscode', '.terraform', '.serverless', '.agentrisk',
]);

/**
 * Correlate an explicit Python agent -> tool bridge -> MCP client -> tools/call chain.
 * No single keyword or MCP presence indicator is promoted to authority evidence.
 */
export function addMcpAuthorityChainEvidence(result) {
  const root = result?.target?.path;
  if (!root || typeof root !== 'string') return result;

  const proof = findMcpAuthorityChain(root);
  if (!proof) return result;

  const derived = [
    makeObservation(
      'GUARDIAN-MCP-AUTHORITY-SOURCE-001',
      'Agent-selected tool action is delegated to the imported tool-call bridge',
      proof.source,
    ),
    makeObservation(
      'GUARDIAN-MCP-AUTHORITY-BRIDGE-001',
      'Tool-call bridge resolves the selected tool through the MCP client manager and delegates execution',
      proof.bridge,
    ),
    makeObservation(
      'GUARDIAN-MCP-AUTHORITY-RESOLVER-001',
      'MCP client manager resolves the selected tool against tools exposed by connected client sessions',
      proof.resolver,
    ),
    {
      ...makeObservation(
        'GUARDIAN-MCP-AUTHORITY-SINK-001',
        'Proven agent tool-call chain reaches an MCP tools/call protocol request',
        proof.sink,
      ),
      agent_relevant_hint: 'mcp_agent_tool_call_authority_chain',
    },
  ];

  const observations = deduplicateAndSort([...(result.observations || []), ...derived]);
  return {
    ...result,
    observations,
    summary: {
      ...result.summary,
      observation_count: observations.length,
      capabilities: capabilityCounts(observations),
      review_required: observations.length > 0,
    },
  };
}

export function findMcpAuthorityChain(rootInput) {
  const root = safeRealDirectory(rootInput);
  if (!root) return null;

  const files = readPythonFiles(root);
  if (!files.length) return null;
  const byPath = new Map(files.map((file) => [file.relativePath, file]));

  for (const source of files) {
    if (!isAgentRuntimePath(source.relativePath)) continue;
    if (!hasAgentToolSelection(source.text)) continue;

    const callToolImport = source.text.match(/\bfrom\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+call_tool\b/);
    if (!callToolImport) continue;
    const bridgePath = moduleToPythonPath(callToolImport[1]);
    const bridge = byPath.get(bridgePath);
    if (!bridge || !isToolBridge(bridge.text)) continue;

    const managerImport = bridge.text.match(/\bfrom\s+([A-Za-z_][A-Za-z0-9_.]*\.mcp_clients\.McpClientManager)\s+import\s+ClientManager\b/);
    if (!managerImport) continue;
    const managerPath = moduleToPythonPath(managerImport[1]);
    const resolver = byPath.get(managerPath);
    if (!resolver || !isMcpToolResolver(resolver.text)) continue;

    const managerSuffix = '/McpClientManager.py';
    if (!managerPath.endsWith(managerSuffix)) continue;
    const mcpClientPrefix = `${managerPath.slice(0, -'McpClientManager.py'.length)}`;
    const sink = files.find((file) => (
      file.relativePath.startsWith(mcpClientPrefix)
      && isMcpToolCallSink(file.text)
    ));
    if (!sink) continue;

    return {
      source: evidenceAt(source, /\bawait\s+call_tool\s*\(\s*tool_name\b/),
      bridge: evidenceAt(bridge, /\bget_client_from_tool\s*\(/),
      resolver: evidenceAt(resolver, /\bclient\.session\.list_tools\s*\(/),
      sink: evidenceAt(sink, /\bmethod\s*=\s*["']tools\/call["']/),
    };
  }

  return null;
}

function hasAgentToolSelection(text) {
  const modelToolSignal = /\b(?:tool_calls|tool_use)\b/i.test(text);
  const selectedToolName = /\btool_name\s*=\s*(?:tool_call\.function\.name|item\.name)\b/.test(text);
  const delegatedCall = /\bawait\s+call_tool\s*\(\s*tool_name\b/.test(text);
  return modelToolSignal && selectedToolName && delegatedCall;
}

function isToolBridge(text) {
  return /\b(?:async\s+def|def)\s+call_tool\s*\(/.test(text)
    && /\bClientManager\.get_client_from_tool\s*\(/.test(text)
    && /\b(?:return\s+)?await\s+session\.call_tool\s*\(/.test(text);
}

function isMcpToolResolver(text) {
  return /\b(?:async\s+def|def)\s+get_client_from_tool\s*\(/.test(text)
    && /\bclient\.session\.list_tools\s*\(/.test(text)
    && /\bclient_tool\.name\s*==\s*tool\b/.test(text);
}

function isMcpToolCallSink(text) {
  return /\bCallToolRequest\s*\(/.test(text)
    && /\bmethod\s*=\s*["']tools\/call["']/.test(text);
}

function isAgentRuntimePath(relativePath) {
  return relativePath.split('/').some((segment) => (
    /^(?:agent|agents|agent_worker|agentworker|worker|workers)$/i.test(segment)
  ));
}

function moduleToPythonPath(moduleName) {
  return `${moduleName.replaceAll('.', '/')}.py`;
}

function evidenceAt(file, pattern) {
  const lines = file.text.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  const line = index >= 0 ? index + 1 : 1;
  return { path: file.relativePath, line_start: line, line_end: line };
}

function makeObservation(detectorId, observation, evidence) {
  return {
    detector_id: detectorId,
    capability: 'mcp',
    observation,
    evidence,
    review_required: true,
  };
}

function safeRealDirectory(rootInput) {
  try {
    const root = fs.realpathSync(path.resolve(rootInput));
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function readPythonFiles(root) {
  const output = [];
  const stack = [root];
  let totalBytes = 0;

  while (stack.length && output.length < MAX_FILES && totalBytes < MAX_TOTAL_BYTES) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.py')) continue;
      if (output.length >= MAX_FILES) break;

      let stat;
      try {
        stat = fs.statSync(absolutePath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) continue;

      let text;
      try {
        text = fs.readFileSync(absolutePath, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;

      totalBytes += stat.size;
      output.push({
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
        text,
      });
    }
  }

  return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function deduplicateAndSort(observations) {
  const seen = new Set();
  const output = [];
  for (const observation of observations) {
    const key = [
      observation.detector_id,
      observation.evidence?.path,
      observation.evidence?.line_start,
      observation.evidence?.line_end,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(observation);
  }
  return output.sort((left, right) => (
    String(left.detector_id).localeCompare(String(right.detector_id))
    || String(left.evidence?.path || '').localeCompare(String(right.evidence?.path || ''))
    || Number(left.evidence?.line_start || 0) - Number(right.evidence?.line_start || 0)
  ));
}

function capabilityCounts(observations) {
  const counts = {};
  for (const observation of observations) {
    counts[observation.capability] = (counts[observation.capability] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
