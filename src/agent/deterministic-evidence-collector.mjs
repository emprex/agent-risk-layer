import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  classifyCanonicalEvidenceRequirement
} from './canonical-evidence-requirement-plan.mjs';

const MAX_FILES = 500;
const MAX_TEXT_BYTES = 256_000;
const MAX_REFS = 20;
const MAX_DEPENDENCY_MANIFEST_READS = 128;

function sha(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function safeExec(cwd, args) {
  try {
    return execFileSync(
      'git',
      ['-C', cwd, ...args],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 20_000_000
      }
    ).trim();
  } catch {
    return '';
  }
}

function trackedFiles(repositoryPath) {
  const raw = safeExec(
    repositoryPath,
    ['ls-files', '-z']
  );

  const allTracked = raw
    .split('\0')
    .filter(Boolean);
  return {
    // Executable sources first; preserve deterministic path order within tiers.
    files: [...allTracked].sort((a,b) => {
      // Keep provider manifests discoverable even when large repositories have
      // hundreds of executable files before their root dependency records.
      const tier = value => /(?:^|\/)(?:pyproject\.toml|requirements(?:-[^/]+)?\.txt|Pipfile|poetry\.lock|package\.json)$/i.test(value) ? 0 :
        /\.(?:py|js|mjs|cjs|ts|tsx|go|rs|java)$/i.test(value) ? 1 : 2;
      return tier(a)-tier(b) || a.localeCompare(b);
    }).slice(0, MAX_FILES),
    totalTrackedFileCount: allTracked.length,
    // Enumerate dependency filenames across the full tracked tree, independent
    // of the bounded generic source scan. No source contents are exposed.
    dependencyPaths: allTracked.filter(file => /(?:^|\/)(?:package\.json|pyproject\.toml|requirements(?:-[^/]+)?\.txt|Pipfile|poetry\.lock|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Pipfile\.lock|Cargo\.lock|go\.sum)$/i.test(file)).sort()
  };
}

function refFor(relativePath) {
  return {
    basename:
      path.basename(relativePath).slice(0, 120),
    pathHash:
      sha(relativePath).slice(0, 24)
  };
}

function boundedRefs(files, pattern) {
  return files
    .filter((file) => pattern.test(file))
    .slice(0, MAX_REFS)
    .map(refFor);
}

function readText(repositoryPath, relativePath) {
  const absolute =
    path.join(repositoryPath, relativePath);

  try {
    const stat = fs.statSync(absolute);

    if (
      !stat.isFile() ||
      stat.size > MAX_TEXT_BYTES
    ) {
      return null;
    }

    const buffer = fs.readFileSync(absolute);

    if (buffer.includes(0)) {
      return null;
    }

    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function collectPackageFacts(
  repositoryPath,
  files
) {
  const manifests =
    files.filter((file) =>
      /(^|\/)package\.json$/i.test(file)
    );

  const packageNames = [];
  const dependencyNames = new Set();
  const pythonManifests = files.filter(file =>
    /(?:^|\/)(?:pyproject\.toml|requirements(?:-[^/]+)?\.txt)$/i.test(file));
  const pythonCandidates = new Set();
  let pythonManifestsReadable = 0;
  let pythonManifestsUnreadable = 0;
  const providerPattern = /(?:openai|anthropic|cohere|mistral|huggingface|langchain|llamaindex|vertex|bedrock|azure[-_]?ai|google[-_]?generative|modelcontextprotocol|mcp(?:[-_]|$)|pinecone|weaviate|qdrant|chromadb)/i;
  for (const file of pythonManifests.slice(0, MAX_DEPENDENCY_MANIFEST_READS)) {
    const text = readText(repositoryPath,file);
    if (text === null) { pythonManifestsUnreadable += 1; continue; }
    pythonManifestsReadable += 1;
    for (const line of text.split(/\r?\n/)) {
      const candidate = line.trim().replace(/^['\"]/, '').split(/[=<>~!;\s'\",\]]/)[0];
      if (/^[a-z0-9_.-]+$/i.test(candidate) && providerPattern.test(candidate)) {
        pythonCandidates.add(candidate.toLowerCase());
      }
    }
    for (const match of text.matchAll(/['\"]([a-z0-9_.-]+)(?:\[[^\]]+\])?(?:[<>=!~][^'\"]*)?['\"]/gi)) {
      if (providerPattern.test(match[1])) pythonCandidates.add(match[1].toLowerCase());
    }
  }

  let packageManifestsReadable = 0;
  let packageManifestsUnreadable = 0;
  for (const file of manifests.slice(0, MAX_DEPENDENCY_MANIFEST_READS)) {
    const text =
      readText(repositoryPath, file);

    if (text === null) { packageManifestsUnreadable += 1; continue; }

    try {
      const parsed = JSON.parse(text);
      packageManifestsReadable += 1;

      if (parsed?.name) {
        packageNames.push(
          String(parsed.name).slice(0, 120)
        );
      }

      for (
        const section of
        [
          'dependencies',
          'devDependencies',
          'optionalDependencies',
          'peerDependencies'
        ]
      ) {
        for (
          const name of
          Object.keys(parsed?.[section] || {})
        ) {
          dependencyNames.add(name);
        }
      }
    } catch {
      packageManifestsUnreadable += 1;
      // Invalid manifests remain visible through artifact refs.
    }
  }

  return {
    packageManifests:
      manifests.slice(0, MAX_REFS).map(refFor),
    packageNames:
      packageNames.slice(0, 20),
    dependencyCount:
      dependencyNames.size,
    pythonProviderPackageCandidates:[...pythonCandidates].sort().slice(0,20),
    pythonManifestCount:pythonManifests.length,
    dependencyPathDiscovery: {
      trackedTreeComplete: true,
      candidatePaths: files.length,
      packageManifestsFound: manifests.length,
      packageManifestsReadLimit: MAX_DEPENDENCY_MANIFEST_READS,
      packageManifestsReadable,
      packageManifestsUnreadable,
      pythonManifestsFound: pythonManifests.length,
      pythonManifestsReadLimit: MAX_DEPENDENCY_MANIFEST_READS,
      pythonManifestsReadable,
      pythonManifestsUnreadable,
      reportedReferenceLimit: MAX_REFS,
      manifestsBeyondReadLimit: manifests.length > MAX_DEPENDENCY_MANIFEST_READS || pythonManifests.length > MAX_DEPENDENCY_MANIFEST_READS,
      completeManifestRead: manifests.length <= MAX_DEPENDENCY_MANIFEST_READS && pythonManifests.length <= MAX_DEPENDENCY_MANIFEST_READS && packageManifestsUnreadable === 0 && pythonManifestsUnreadable === 0,
      referencesBeyondLimit: files.length > MAX_REFS
    },
    dependencyNames:
      [...dependencyNames]
        .sort()
        .slice(0, 40),
    lockfiles:
      boundedRefs(
        files,
        /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements(?:-[^/]+)?\.txt|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum)$/i
      )
  };
}

function collectTextSignals(
  repositoryPath,
  files
) {
  const credentialRefs = new Map();
  const endpointHashes = new Map();
  const mcpToolFiles = new Map();
  // Candidate code/config signals only; never claim authenticated enforcement.
  const workloadIdentityRefs = new Map();
  let workloadIdentityMatchedFileCount = 0;
  const workloadSignals = Object.freeze({
    audience_check_hint: /\b(?:audience|aud)\b/i,
    issuer_check_hint: /\b(?:issuer|iss)\b/i,
    identity_validation_hint: /\b(?:verify[_ -]?(?:jwt|token)|jwt\.decode|jwt\.verify|jwtVerify|require[_ -]?auth)\b/i,
    mutual_tls_hint: /\b(?:mTLS|mutual[_ -]?tls|client[_ -]?cert)\b/i,
    workload_identity_hint: /\b(?:workload[_ -]?identity|service[_ -]?account|spiffe)\b/i
  });


  const textCandidates =
    files.filter((file) =>
      /\.(?:js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|sh|json|ya?ml|toml|ini|conf|cfg|properties|md|txt|tf|hcl|sql)$/i
        .test(file)
    );

  const inspectedTextCandidates = textCandidates.slice(0, 300);
  let readableTextFiles = 0;

  for (const file of inspectedTextCandidates) {
    const text = readText(repositoryPath, file);
    if (!text) continue;
    readableTextFiles += 1;

    const ref = refFor(file);

    if (
      /\b(?:process\.env|os\.environ|getenv\s*\(|secret|credential|api[_-]?key|token)\b/i
        .test(text)
    ) {
      credentialRefs.set(
        ref.pathHash,
        ref
      );
    }

    if (
      /\b(?:mcp|tool(?:s|call|definition)?|function[_ -]?calling|plugin)\b/i
        .test(text)
    ) {
      mcpToolFiles.set(
        ref.pathHash,
        ref
      );
    }

    const tags = Object.entries(workloadSignals)
      .filter(([,pattern]) => pattern.test(text))
      .map(([tag]) => tag);
    if (tags.length >= 2) {
      workloadIdentityMatchedFileCount += 1;
      if (workloadIdentityRefs.size < 12) {
        workloadIdentityRefs.set(ref.pathHash, { ...ref, signalTypes: tags });
      }
    }

    for (
      const match of
      text.matchAll(
        /https?:\/\/([a-z0-9.-]+)(?::\d+)?/gi
      )
    ) {
      const host =
        String(match[1] || '')
          .toLowerCase();

      if (!host) continue;

      endpointHashes.set(
        sha(host).slice(0, 24),
        {
          destinationHash:
            sha(host).slice(0, 24),
          observedIn: ref
        }
      );

      if (endpointHashes.size >= 40) {
        break;
      }
    }
  }

  return {
    credentialReferenceFiles:
      [...credentialRefs.values()]
        .slice(0, MAX_REFS),
    mcpAndToolReferenceFiles:
      [...mcpToolFiles.values()]
        .slice(0, MAX_REFS),
    externalDestinationObservations:
      [...endpointHashes.values()]
        .slice(0, 40),
    workloadIdentitySignalCandidates: [...workloadIdentityRefs.values()],
    workloadIdentityCandidateCount: workloadIdentityMatchedFileCount,
    workloadIdentityCandidateLimit: 12,
    textScanCoverage: {
      candidatesWithinTrackedFileLimit: textCandidates.length,
      attempted: inspectedTextCandidates.length,
      readable: readableTextFiles,
      capped: textCandidates.length > inspectedTextCandidates.length
    }
  };
}

function repositoryFacts({
  repositoryPath,
  frozen
}) {
  const tracked = trackedFiles(repositoryPath);
  const files = tracked.files;
  const textFacts = collectTextSignals(repositoryPath, files);

  const revision =
    safeExec(
      repositoryPath,
      ['rev-parse', 'HEAD']
    ) || frozen?.target?.revision || null;

  const inspection =
    frozen?.inspection || {};

  return {
    revision,
    environment:
      inspection?.subject?.environment || null,
    projectName:
      inspection?.subject?.projectName || null,
    gitDirty:
      inspection?.subject?.gitDirty ?? null,
    trackedFileCount: tracked.totalTrackedFileCount,
    discoveryCoverage: {
      totalTrackedFiles: tracked.totalTrackedFileCount,
      trackedFilesConsidered: files.length,
      trackedFileScanCapped: tracked.totalTrackedFileCount > files.length,
      // Counts below apply only to the bounded first MAX_FILES tracked paths.
      textCandidatesWithinTrackedFileLimit: textFacts.textScanCoverage.candidatesWithinTrackedFileLimit,
      textFilesAttempted: textFacts.textScanCoverage.attempted,
      textFilesReadable: textFacts.textScanCoverage.readable,
      textFileScanCapped: textFacts.textScanCoverage.capped,
      completeTrackedAndTextScan:
        tracked.totalTrackedFileCount === files.length &&
        !textFacts.textScanCoverage.capped &&
        textFacts.textScanCoverage.readable === textFacts.textScanCoverage.attempted
    },
    architectureArtifacts:
      boundedRefs(
        files,
        /(?:architecture|diagram|trust|data[-_ ]?flow|threat[-_ ]?model|design|adr|readme|docs?\/)/i
      ),
    policyArtifacts:
      boundedRefs(
        files,
        /(?:policy|security|privacy|governance|approval|access[-_ ]?control|retention|classification|risk|incident|rollback|recovery|runbook)/i
      ),
    configurationArtifacts:
      boundedRefs(
        files,
        /(?:\.env\.example$|config|settings|compose|dockerfile|k8s|kubernetes|helm|terraform|\.tf$|\.ya?ml$|\.toml$|\.json$)/i
      ),
    ciCdArtifacts:
      boundedRefs(
        files,
        /(?:^|\/)\.github\/workflows\/|gitlab-ci|jenkinsfile|circleci|buildkite/i
      ),
    ...collectPackageFacts(
      repositoryPath,
      tracked.dependencyPaths
    ),
    ...textFacts,
    observedTechnologies:
      Array.isArray(
        inspection?.observedTechnologies
      )
        ? inspection.observedTechnologies.slice(0, 40)
        : [],
    inspectorSummary:
      inspection?.summary || null,
    sourceCoverage:
      inspection?.scope?.sourceCoverage || null
  };
}

function observationsForCollector(
  collector,
  facts
) {
  switch (collector) {
    case 'target_identity':
      return {
        revision: facts.revision,
        environment: facts.environment,
        projectName: facts.projectName,
        gitDirty: facts.gitDirty
      };

    case 'architecture_and_inventory':
      return {
        architectureArtifacts:
          facts.architectureArtifacts,
        mcpAndToolReferenceFiles:
          facts.mcpAndToolReferenceFiles,
        credentialReferenceFiles:
          facts.credentialReferenceFiles,
        observedTechnologies:
          facts.observedTechnologies,
        providerPackageCandidates:
          [...new Set([...facts.dependencyNames.filter(name =>
            /(?:openai|anthropic|cohere|mistral|huggingface|langchain|llamaindex|vertex|bedrock|azure[-_]?ai|google[-_]?generative|modelcontextprotocol|mcp(?:[-_]|$)|pinecone|weaviate|qdrant|chromadb)/i.test(name)
          ), ...facts.pythonProviderPackageCandidates])].sort().slice(0,20),
        providerPackageCandidateLimit: 20,
        dependencyCount: facts.dependencyCount,
        externalDestinationObservationCount:
          facts.externalDestinationObservations.length,
        externalDestinationObservations:
          facts.externalDestinationObservations.slice(0, 8),
        trackedFileCount:
          facts.trackedFileCount,
        discoveryCoverage:
          facts.discoveryCoverage
      };

    case 'source_and_configuration':
      return {
        configurationArtifacts:
          facts.configurationArtifacts,
        ciCdArtifacts:
          facts.ciCdArtifacts,
        mcpAndToolReferenceFiles:
          facts.mcpAndToolReferenceFiles,
        credentialReferenceFiles:
          facts.credentialReferenceFiles,
        externalDestinationObservations:
          facts.externalDestinationObservations,
        sourceCoverage:
          facts.sourceCoverage,
        discoveryCoverage:
          facts.discoveryCoverage
      };

    case 'policy_and_documentation':
      return {
        policyArtifacts:
          facts.policyArtifacts,
        architectureArtifacts:
          facts.architectureArtifacts
      };

    case 'dependency_and_build':
      return {
        packageManifests:
          facts.packageManifests,
        packageNames:
          facts.packageNames,
        dependencyCount:
          facts.dependencyCount,
        dependencyNames:
          facts.dependencyNames,
        dependencyPathDiscovery:
          facts.dependencyPathDiscovery,
        lockfiles:
          facts.lockfiles,
        ciCdArtifacts:
          facts.ciCdArtifacts,
        // A bounded file scan cannot establish a complete dependency bill.
        discoveryCoverage:
          facts.discoveryCoverage
      };

    case 'network_and_egress':
      return {
        externalDestinationObservations:
          facts.externalDestinationObservations,
        configurationArtifacts:
          facts.configurationArtifacts,
        mcpAndToolReferenceFiles:
          facts.mcpAndToolReferenceFiles
      };

    case 'data_and_capability_observation':
      return {
        observedTechnologies:
          facts.observedTechnologies,
        mcpAndToolReferenceFiles:
          facts.mcpAndToolReferenceFiles,
        credentialReferenceFiles:
          facts.credentialReferenceFiles,
        externalDestinationObservations:
          facts.externalDestinationObservations,
        policyArtifacts:
          facts.policyArtifacts
      };

    default:
      return {};
  }
}

export function collectDeterministicEvidence({
  repositoryPath,
  frozen,
  requirements = []
} = {}) {
  const facts =
    repositoryFacts({
      repositoryPath,
      frozen
    });

  const requirementObservations =
    (Array.isArray(requirements)
      ? requirements
      : [])
      .map((requirement) => {
        const text =
          String(requirement || '').trim();

        const classification =
          classifyCanonicalEvidenceRequirement(
            text
          );

        if (
          classification.mode !==
          'machine_collectable'
        ) {
          return null;
        }

        const observations = {};

        for (
          const collector of
          classification.collectors || []
        ) {
          observations[collector] =
            observationsForCollector(
              collector,
              facts
            );
          if (collector === 'source_and_configuration' &&
              /\bARL-KB-026\b/i.test(text)) {
            observations[collector].workloadIdentitySignalCandidates =
              facts.workloadIdentitySignalCandidates;
            observations[collector].workloadIdentityCandidateCount =
              facts.workloadIdentityCandidateCount;
            observations[collector].workloadIdentityCandidateLimit = 12;
            observations[collector].workloadIdentityCoverage =
              facts.discoveryCoverage;
          }
        }

        return {
          requirement: text,
          collectors:
            classification.collectors || [],
          observations
        };
      })
      .filter(Boolean);

  return {
    schema:
      'arl.deterministic-evidence-collection.v1',
    targetRevision: facts.revision,
    privacyBoundary:
      'No source code, secret values, credential values or raw external destination names are included. Paths and destinations are represented by bounded metadata and hashes where appropriate.',
    requirementObservations
  };
}
