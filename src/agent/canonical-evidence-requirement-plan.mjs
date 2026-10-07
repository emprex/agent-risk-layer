const MACHINE_COLLECTABLE_PATTERNS = Object.freeze([
  /\b(?:exact )?assessed system\b.*\b(?:version|environment|scope)\b/i,
  /\bsource or configuration evidence\b/i,
  /\bcontrol configuration or source location\b/i,
  /\bread-only discovery evidence\b/i,
  /\bobserved (?:model|provider|tool|mcp|plugin|api|credential|runtime|network|dependency|asset|agent)/i,
  /\bsecret-store, environment, ci\/cd and runtime references\b/i,
  /\brelevant source, proxy, dns, firewall, allowlist or tool configuration\b/i,
  /\bexact (?:production )?version\b.*\b(?:deployment|identity|artefact|artifact)\b/i,
  /\bsource build records?\b/i,
  /\bdependency and version inventory\b/i,
  /\btool catalogue\b/i,
  /\bnetwork configuration\b/i,
  /\blockfile\b/i
]);

const ACTIVE_TEST_PATTERNS = Object.freeze([
  /\bpositive and abuse inputs\b/i,
  /\bbounded (?:positive|negative) evidence\b/i,
  /\btest result\b/i,
  /\bobserved runtime (?:dns|http|proxy|tool|network) records\b/i,
  /\battempted unapproved destinations\b/i,
  /\badversarial retest\b/i
]);

const HUMAN_ONLY_PATTERNS = Object.freeze([
  /\breviewer identity\b/i,
  /\btester identity\b/i,
  /\baccountable human\b/i,
  /\bhuman decision\b/i,
  /\bhuman reviewer\b/i,
  /\borganisation-approved\b/i,
  /\basserted legal-basis\b/i,
  /\bapproved provider\b/i,
  /\bauthoritative declared inventory\b/i,
  /\bdecision record\b/i,
  /\bapproval\b/i
]);

export function classifyCanonicalEvidenceRequirement(requirement) {
  const text = String(requirement || '').trim();

  if (!text) {
    return {
      mode: 'unclassified',
      reason: 'empty_requirement'
    };
  }

  if (ACTIVE_TEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: 'active_test_or_runtime',
      reason:
        'The canonical requirement calls for runtime, abuse-case or bounded-test evidence and must not be synthesized from static source review.'
    };
  }

  if (HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: 'human_only',
      reason:
        'The canonical requirement depends on accountable human, organisational or approval evidence.'
    };
  }

  if (MACHINE_COLLECTABLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: 'machine_collectable',
      reason:
        'The canonical requirement can be supported by deterministic frozen-target or authoritative assessment observations.'
    };
  }

  return {
    mode: 'human_only',
    reason:
      'No reviewed deterministic collector is registered for this canonical requirement; ARL fails closed to human review.'
  };
}

export function buildCanonicalEvidenceRequirementPlan(requirements = []) {
  return (Array.isArray(requirements) ? requirements : [])
    .map((requirement) => {
      const classified =
        classifyCanonicalEvidenceRequirement(requirement);

      return {
        requirement: String(requirement || '').trim(),
        ...classified
      };
    })
    .filter((item) => item.requirement);
}
