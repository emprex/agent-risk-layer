const ACTIVE_TEST_PATTERNS = Object.freeze([
  /\bpositive and abuse inputs\b/i,
  /\bbounded (?:positive|negative) evidence\b/i,
  /\bobserved runtime\b/i,
  /\bidentity, network, provider, billing or audit evidence\b/i,
  /\btest result\b/i,
  /\btested .* path executed\b/i,
  /\bpolicy, authorization, tool or audit events proving whether the tested\b/i,
  /\battempted unapproved destinations\b/i,
  /\badversarial retest\b/i,
  /\breplay(?:ed|ing)? representative\b/i,
  /\battempt (?:to|a|an)\b/i,
  /\bverify .* denial\b/i
]);

const HUMAN_ONLY_PATTERNS = Object.freeze([
  /\breviewer identity\b/i,
  /\btester identity\b/i,
  /\baccountable human\b/i,
  /\bhuman decision\b/i,
  /\bhuman reviewer\b/i,
  /\bresidual-risk\b/i,
  /\bresidual risk\b/i,
  /\borganisation-approved\b/i,
  /\basserted legal-basis\b/i,
  /\blegal-basis\b/i,
  /\bdecision record\b/i,
  /\baccountable owner\b/i,
  /\baccountable approval\b/i,
  /\bapproved provider and configuration record\b/i,
  /\bauthoritative declared inventory\b/i,
  /\bauthoritative .* register\b/i
]);

const MACHINE_FAMILIES = Object.freeze([
  {
    id: 'target_identity',
    patterns: [
      /\b(?:exact )?assessed system\b.*\b(?:version|environment|scope)\b/i,
      /\bexact assessed .* version\b/i,
      /\bassessed system, exact version\b/i,
      /\bproduction version\b.*\bdeployment identity\b/i
    ]
  },
  {
    id: 'architecture_and_inventory',
    patterns: [
      /\bobserved inventory\b/i,
      /\bread-only discovery evidence\b/i,
      /\barchitecture and trust-boundary model\b/i,
      /\bversioned architecture\b/i,
      /\btrust[- ]boundary model\b/i,
      /\bdocumented actors, trust zones, data flows, stores, tools, network destinations and approval points\b/i,
      /\bobservable agents, models, prompts, tools, data stores, service identities, deployments and scheduled jobs\b/i,
      /\bmodel, mcp, plugin, api and other provider inventory\b/i,
      /\bcredential or workload-identity inventory\b/i,
      /\bmemory, vector, embedding|persistent memory stores|vector databases|indexes|namespaces/i
    ]
  },
  {
    id: 'source_and_configuration',
    patterns: [
      /\bsource or configuration evidence\b/i,
      /\bcontrol configuration or source location\b/i,
      /\brelevant source, proxy, dns, firewall, allowlist or tool configuration\b/i,
      /\bsecret-store, environment, ci\/cd and runtime references\b/i,
      /\bconfiguration governing outbound access\b/i,
      /\bprovider\/configuration drift\b/i,
      /\bconfiguration materially affecting\b/i
    ]
  },
  {
    id: 'policy_and_documentation',
    patterns: [
      /\bversioned .* policy\b/i,
      /\bdata-classification and handling policy\b/i,
      /\bsupported data classes\b/i,
      /\brestricted-class definitions\b/i,
      /\bdocumented acceptance or readiness criteria\b/i,
      /\bevidence requirements and blocker rules\b/i,
      /\brecovery, rollback or operational-readiness evidence\b/i,
      /\bchange-control, fallback or disablement evidence\b/i,
      /\buser-facing transparency or notice evidence\b/i,
      /\bright[s-]handling, contact or escalation route\b/i
    ]
  },
  {
    id: 'dependency_and_build',
    patterns: [
      /\bdependency and version inventory\b/i,
      /\bsoftware and ai dependency bill\b/i,
      /\bsbom\b/i,
      /\blockfile\b/i,
      /\bsource build records?\b/i,
      /\bbuild, registry and deployment provenance\b/i,
      /\bmodel versions? and digests?\b/i,
      /\bimmutable (?:revision|digest|artefact|artifact)\b/i
    ]
  },
  {
    id: 'network_and_egress',
    patterns: [
      /\bexternal destinations\b/i,
      /\begress routes?\b/i,
      /\bnetwork configuration\b/i,
      /\bauthorised external destinations\b/i,
      /\btools, webhooks, callbacks and egress routes\b/i
    ]
  },
  {
    id: 'data_and_capability_observation',
    patterns: [
      /\bimpact-relevant capabilities\b/i,
      /\breachable assets\b/i,
      /\bdata access\b/i,
      /\bpersonal-data categories, purposes, destinations and retention\b/i,
      /\bevidence showing classification and handling across representative\b/i,
      /\bevidence of redaction, denial, retention or export restriction\b/i,
      /\bcapability or configuration materially affecting\b/i
    ]
  }
]);

function matchingMachineFamilies(text) {
  return MACHINE_FAMILIES
    .filter((family) =>
      family.patterns.some((pattern) => pattern.test(text))
    )
    .map((family) => family.id);
}

export function classifyCanonicalEvidenceRequirement(requirement) {
  const text = String(requirement || '').trim();

  if (!text) {
    return {
      mode: 'unclassified',
      reason: 'empty_requirement',
      collectors: []
    };
  }

  if (ACTIVE_TEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: 'active_test_or_runtime',
      reason:
        'The canonical requirement calls for runtime, abuse-case, execution-path or bounded-test evidence and must not be synthesized from static source review.',
      collectors: []
    };
  }

  if (HUMAN_ONLY_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: 'human_only',
      reason:
        'The canonical requirement depends on accountable human, organisational, legal-basis or approval evidence.',
      collectors: []
    };
  }

  const collectors = matchingMachineFamilies(text);

  if (collectors.length > 0) {
    return {
      mode: 'machine_collectable',
      reason:
        'The canonical requirement can be supported by deterministic frozen-target or authoritative assessment observations.',
      collectors
    };
  }

  return {
    mode: 'human_only',
    reason:
      'No reviewed deterministic collector is registered for this canonical requirement; ARL fails closed to human review.',
    collectors: []
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
