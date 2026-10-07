import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  classifyCanonicalEvidenceRequirement
} from '../canonical-evidence-requirement-plan.mjs';

const MAX_FILES = 500;
const MAX_TEXT_BYTES = 256_000;
const MAX_REFS = 20;

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

  return raw
    .split('\0')
    .filter(Boolean)
    .slice(0, MAX_FILES);
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

  for (const file of manifests.slice(0, 20)) {
    const text =
      readText(repositoryPath, file);

    if (!text) continue;

    try {
      const parsed = JSON.parse(text);

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

  const textCandidates =
    files.filter((file) =>
      /\.(?:js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|sh|json|ya?ml|toml|ini|conf|cfg|properties|md|txt|tf|hcl|sql)$/i
        .test(file)
    );

  for (
    const file of
    textCandidates.slice(0, 300)
  ) {
    const text =
      readText(repositoryPath, file);

    if (!text) continue;

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
        .slice(0, 40)
  };
}

function repositoryFacts({
  repositoryPath,
  frozen
}) {
  const files =
    trackedFiles(repositoryPath);

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
    trackedFileCount: files.length,
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
      files
    ),
    ...collectTextSignals(
      repositoryPath,
      files
    ),
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
        trackedFileCount:
          facts.trackedFileCount
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
          facts.sourceCoverage
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
        lockfiles:
          facts.lockfiles,
        ciCdArtifacts:
          facts.ciCdArtifacts
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
