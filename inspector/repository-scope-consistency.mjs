import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const REPOSITORY_SCOPE_RULE_ID = 'ARL-REPO-003';
export const REPOSITORY_SCOPE_CLASSIFICATION = 'repository-deployment-hardening';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_SIGNALS = 50;
const ACTIVE_WORDS = /\b(?:current|production|active|supported)\b/i;
const RETIRED_WORDS = /\b(?:retired|superseded|former|legacy|obsolete|deprecated)\b/i;
const TOOLCHAINS = ['Flutter', 'Expo', 'React Native'];
const OPERATIONAL_DOC = /^(?:README|SECURITY|DEPLOYMENT|OPERATIONS|RUNBOOK|QUICKSTART|SETUP|INSTALL)(?:[-_.][^/]*)?\.md$/i;
const OPERATIONAL_PATH = /(?:^|\/)(?:scripts\/|\.github\/workflows\/|render\.ya?ml$|Dockerfile(?:\.[^/]*)?$|package\.json$|package-lock\.json$)/i;
const HISTORICAL_PATH = /(?:^|\/)(?:archive|archives|history|historical|legacy-docs|memos?)(?:\/|$)/i;

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeRepoPath(value) {
  const text = clean(value, 200).replace(/^\.\//, '').replace(/\/$/, '');
  if (!text || text.startsWith('/') || text.includes('..') || /^https?:/i.test(text)) return null;
  return text;
}

function isOperationalFile(relative) {
  if (HISTORICAL_PATH.test(relative)) return false;
  const base = path.basename(relative);
  return OPERATIONAL_DOC.test(base)
    || OPERATIONAL_PATH.test(relative)
    || /^docs\/(?:.*(?:deploy|runbook|quickstart|setup|install).*)\.md$/i.test(relative);
}

function knownToolchains(text) {
  return TOOLCHAINS.filter((name) => new RegExp(`\\b${name.replace(' ', '[ -]?')}\\b`, 'i').test(text));
}

function extractBacktickPaths(text) {
  const values = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const candidate = normalizeRepoPath(match[1]);
    if (candidate && (candidate.includes('/') || /^[A-Za-z0-9_.-]+\.(?:js|mjs|json|ya?ml|md)$/i.test(candidate))) values.push(candidate);
  }
  return values;
}

function declarationClauses(line) {
  return String(line)
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9`])/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function declarationEvidence(files) {
  const activePaths = new Map();
  const retiredPaths = new Map();
  const activeToolchains = new Map();
  const retiredToolchains = new Map();
  const record = (map, key, value) => { if (!map.has(key)) map.set(key, value); };

  for (const file of files) {
    if (!isOperationalFile(file.path) || !/\.md$/i.test(file.path)) continue;
    file.content.split(/\r?\n/).forEach((line, offset) => {
      for (const clause of declarationClauses(line)) {
        const hasActive = ACTIVE_WORDS.test(clause);
        const hasRetired = RETIRED_WORDS.test(clause);
        if (!hasActive && !hasRetired) continue;
        const evidence = { file: file.path, line: offset + 1, fact: clean(clause, 220) };

        for (const declaredPath of extractBacktickPaths(clause)) {
          if (hasActive) record(activePaths, declaredPath, evidence);
          if (hasRetired) record(retiredPaths, declaredPath, evidence);
        }
        for (const toolchain of knownToolchains(clause)) {
          if (hasActive) record(activeToolchains, toolchain, evidence);
          if (hasRetired) record(retiredToolchains, toolchain, evidence);
        }
      }
    });
  }
  return { activePaths, retiredPaths, activeToolchains, retiredToolchains };
}

function configEvidence(files) {
  const file = files.find((item) => item.path === '.agentrisk.json');
  const empty = { activePaths: [], retiredPaths: [], activeToolchains: [], retiredToolchains: [] };
  if (!file) return empty;
  try {
    const parsed = JSON.parse(file.content);
    const scope = parsed.repositoryScope && typeof parsed.repositoryScope === 'object' ? parsed.repositoryScope : {};
    const list = (value) => Array.isArray(value) ? value : [];
    return {
      activePaths: list(scope.activeComponents).map((item) => normalizeRepoPath(typeof item === 'string' ? item : item?.path)).filter(Boolean),
      retiredPaths: list(scope.retiredComponents).map((item) => normalizeRepoPath(typeof item === 'string' ? item : item?.path)).filter(Boolean),
      activeToolchains: list(scope.activeToolchains).map((item) => clean(item, 80)).filter(Boolean),
      retiredToolchains: list(scope.retiredToolchains).map((item) => clean(item, 80)).filter(Boolean),
    };
  } catch {
    return empty;
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function operationalReference(line, retiredPath) {
  if (!line.includes(retiredPath) || RETIRED_WORDS.test(line)) return false;
  const pathPattern = escapeRegex(retiredPath);
  return new RegExp(`(?:\\bcd\\s+|--prefix\\s+|working-directory\\s*:\\s*|cwd\\s*[:=]\\s*|\\b(?:run|build|start|test|deploy)\\b[^\\n]{0,120})${pathPattern}`, 'i').test(line)
    || (/(?:npm|pnpm|yarn|node|flutter|docker|bash|sh)\b/i.test(line) && line.includes(retiredPath));
}

function retiredToolchainReference(line, toolchain) {
  if (RETIRED_WORDS.test(line)) return false;
  if (toolchain === 'Expo') return /\bEXPO_PUBLIC_[A-Z0-9_]+\b|\bnpx\s+expo\b|\beas\s+(?:build|submit|update)\b|\bexpo\s+(?:start|run:android|run:ios)\b/i.test(line);
  if (toolchain === 'React Native') return /\bnpx\s+react-native\b|\breact-native\s+(?:run-android|run-ios|start)\b/i.test(line);
  if (toolchain === 'Flutter') return /\bflutter\s+(?:run|build|pub|get|test)\b/i.test(line);
  return false;
}

function addSignal(signals, item) {
  // One stale operational line is one repository/deployment hardening signal even when
  // more than one retired declaration corroborates it. This prevents overlapping
  // component/toolchain declarations from manufacturing duplicate findings.
  const key = `${item.file}:${item.line}:${item.staleReference}`;
  const existing = signals.find((signal) => signal._key === key);
  if (existing) {
    const values = (field) => [...new Set([existing[field], item[field]].filter(Boolean))];
    existing.corroboratingRetiredComponents = values('retiredComponent');
    existing.corroboratingRetiredToolchains = values('retiredToolchain');
    return;
  }
  if (signals.length >= MAX_SIGNALS) return;
  signals.push({
    ...item,
    corroboratingRetiredComponents: item.retiredComponent ? [item.retiredComponent] : [],
    corroboratingRetiredToolchains: item.retiredToolchain ? [item.retiredToolchain] : [],
    _key: key,
  });
}

function applyConfigDeclarations(declarations, config) {
  for (const value of config.activePaths) if (!declarations.activePaths.has(value)) declarations.activePaths.set(value, { file: '.agentrisk.json', line: null, fact: `Declared active component ${value}` });
  for (const value of config.retiredPaths) if (!declarations.retiredPaths.has(value)) declarations.retiredPaths.set(value, { file: '.agentrisk.json', line: null, fact: `Declared retired component ${value}` });
  for (const value of config.activeToolchains) if (!declarations.activeToolchains.has(value)) declarations.activeToolchains.set(value, { file: '.agentrisk.json', line: null, fact: `Declared active toolchain ${value}` });
  for (const value of config.retiredToolchains) if (!declarations.retiredToolchains.has(value)) declarations.retiredToolchains.set(value, { file: '.agentrisk.json', line: null, fact: `Declared retired toolchain ${value}` });
}

export function detectRepositoryScopeConsistency(inputFiles) {
  const files = Array.isArray(inputFiles)
    ? inputFiles.map((item) => ({ path: clean(item.path, 240).replaceAll('\\', '/'), content: String(item.content ?? '') }))
    : Object.entries(inputFiles || {}).map(([filePath, content]) => ({ path: clean(filePath, 240).replaceAll('\\', '/'), content: String(content ?? '') }));
  const declarations = declarationEvidence(files);
  applyConfigDeclarations(declarations, configEvidence(files));

  const hasActiveDeclaration = declarations.activePaths.size > 0 || declarations.activeToolchains.size > 0;
  const hasRetiredDeclaration = declarations.retiredPaths.size > 0 || declarations.retiredToolchains.size > 0;
  if (!hasActiveDeclaration || !hasRetiredDeclaration) {
    return { status: 'insufficient-corroborating-scope-evidence', ruleId: REPOSITORY_SCOPE_RULE_ID, findings: [] };
  }

  const presentPaths = new Set(files.map((item) => item.path));
  const signals = [];

  for (const [retiredPath, retiredEvidence] of declarations.retiredPaths) {
    const retiredStillPresent = [...presentPaths].some((candidate) => candidate === retiredPath || candidate.startsWith(`${retiredPath}/`));
    for (const file of files) {
      if (!isOperationalFile(file.path)) continue;
      file.content.split(/\r?\n/).forEach((line, offset) => {
        if (!operationalReference(line, retiredPath)) return;
        const active = declarations.activePaths.entries().next().value;
        addSignal(signals, {
          retiredComponent: retiredPath,
          retiredToolchain: null,
          activeComponent: active ? active[0] : null,
          activeToolchain: declarations.activeToolchains.keys().next().value || null,
          staleReference: clean(line, 180),
          file: file.path,
          line: offset + 1,
          retiredStillPresent,
          evidenceBasis: { activeDeclaration: active ? active[1] : declarations.activeToolchains.values().next().value || null, retiredDeclaration: retiredEvidence },
        });
      });
    }
  }

  for (const [retiredToolchain, retiredEvidence] of declarations.retiredToolchains) {
    for (const file of files) {
      if (!isOperationalFile(file.path)) continue;
      file.content.split(/\r?\n/).forEach((line, offset) => {
        if (!retiredToolchainReference(line, retiredToolchain)) return;
        const activePath = declarations.activePaths.entries().next().value;
        const activeToolchain = [...declarations.activeToolchains.keys()].find((value) => value !== retiredToolchain) || null;
        addSignal(signals, {
          retiredComponent: null,
          retiredToolchain,
          activeComponent: activePath ? activePath[0] : null,
          activeToolchain,
          staleReference: clean(line, 180),
          file: file.path,
          line: offset + 1,
          retiredStillPresent: null,
          evidenceBasis: { activeDeclaration: activePath ? activePath[1] : (activeToolchain ? declarations.activeToolchains.get(activeToolchain) : null), retiredDeclaration: retiredEvidence },
        });
      });
    }
  }

  const findings = signals.map(({ _key, ...signal }) => ({
    ruleId: REPOSITORY_SCOPE_RULE_ID,
    title: 'Active repository references a retired or superseded component',
    classification: REPOSITORY_SCOPE_CLASSIFICATION,
    severity: 'low',
    confidence: signal.retiredComponent && signal.activeComponent ? 'high' : 'medium',
    summary: 'A current production/active component and a retired/superseded component are both explicitly declared, while an operational file still contains a reference associated with the retired scope.',
    remediation: 'Remove or update the stale operational reference, or correct the scope declarations if the retired component is still intentionally active. Re-run the bounded repository-scope check after the change.',
    evidence: signal,
  }));

  return {
    status: findings.length ? 'stale-active-scope-references-observed' : 'no-stale-active-scope-reference-observed',
    ruleId: REPOSITORY_SCOPE_RULE_ID,
    declarations: {
      activeComponents: [...declarations.activePaths.keys()],
      retiredComponents: [...declarations.retiredPaths.keys()],
      activeToolchains: [...declarations.activeToolchains.keys()],
      retiredToolchains: [...declarations.retiredToolchains.keys()],
    },
    findings,
  };
}

function trackedFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20_000_000 });
    return output.split('\0').filter(Boolean).slice(0, MAX_FILES);
  } catch {
    return null;
  }
}

function filesystemFiles(root) {
  const found = [];
  const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', '.dart_tool', '.next']);
  const walk = (directory) => {
    if (found.length >= MAX_FILES) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (found.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) walk(absolute);
      } else if (entry.isFile()) found.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
    }
  };
  walk(root);
  return found;
}

export function scanRepositoryScopeConsistency(rootInput = '.') {
  const root = fs.realpathSync(path.resolve(rootInput));
  const relativeFiles = trackedFiles(root) || filesystemFiles(root);
  const files = [];
  for (const relative of relativeFiles) {
    if (!isOperationalFile(relative) && relative !== '.agentrisk.json') continue;
    const absolute = path.join(root, relative);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
    } catch {
      // Unreadable or disappearing evidence constrains the check; it is not a finding.
    }
  }
  return detectRepositoryScopeConsistency(files);
}
