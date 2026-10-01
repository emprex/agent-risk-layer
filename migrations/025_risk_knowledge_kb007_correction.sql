-- ARL-KB-007 semantic correction.
-- Aligns the control with third-party AI/tool provider assessment:
-- provider inventory, approved scope, dormant provider paths,
-- configuration drift, accountable change control and version-bound evidence.

UPDATE risk_knowledge_entries
SET
  knowledge_version='ARL-RKA-1.2.0',
  content_digest='ac0f9fa807c348a227bf6df6c569185c07df13648ba33a07ea70b671bc422621',
  updated_at='2026-10-01'
WHERE id='ARL-KB-007';

UPDATE risk_knowledge_checks
SET
  objective='Determine whether every external AI, MCP, tool, plugin, vector, observability or other service provider used by the assessed system is identified, approved, bounded and subject to accountable change review.',
  method='Inventory every external provider or remotely operated dependency that can influence agent behaviour, receive data, provide model output, expose tools or affect deployment. Compare the observed provider set and configuration with the approved system scope. For each applicable provider, review the approved purpose, data sent or received, deployment or endpoint configuration, version/change controls, incident or compromise response, disablement or fallback path, and evidence of accountable approval. Treat dormant but activatable external-provider paths as review items when they can be enabled without an approved scope change. Use synthetic/local evidence only and do not exercise real third-party services without explicit authorisation.',
  required_evidence_json='["ARL-KB-007 assessed system, exact version, environment and approved scope","ARL-KB-007 observed model, MCP, plugin, API and other provider inventory","ARL-KB-007 approved provider and configuration record, including data and network boundaries where applicable","ARL-KB-007 evidence of provider/configuration drift, dormant external-provider paths or confirmation that none are present","ARL-KB-007 change-control, fallback or disablement evidence for applicable external providers","ARL-KB-007 reviewer identity, role, timestamp and evidence digest"]',
  pass_condition='ARL-KB-007 passes only when every applicable external provider or remotely operated dependency observed in the exact assessed version is identified and consistent with the approved scope; its relevant data, network and authority boundaries are documented; material provider or configuration changes require accountable review; and version-bound evidence supports the conclusion. A dormant external-provider path does not pass merely because credentials are currently absent if it can be activated outside the approved change process.',
  fail_condition='ARL-KB-007 fails when an external AI, MCP, plugin, vector, observability or other provider can influence behaviour, receive data or become active without being identified and approved; when observed provider/configuration state differs materially from the approved scope without accountable review; when provider change, compromise, fallback or disablement is unmanaged; or when the conclusion is unsupported by version-bound evidence.',
  content_digest='e4b810fca1e936937c1a87873c5c95f5f5a9e769faf5b70e031827dd1f3102db',
  updated_at='2026-10-01'
WHERE entry_id='ARL-KB-007';

UPDATE risk_knowledge_solutions
SET
  control_objective='Ensure external AI and tool providers are explicitly identified, approved, bounded and reassessed so provider and supply-chain risk remains visible.',
  recommended_remediation='Maintain an approved provider register tied to system scope and exact configuration; document data and network boundaries; require accountable approval for provider or endpoint changes; define incident, disablement, fallback and exit controls; and reassess after material provider changes.',
  content_digest='98cad84858d3ae495fdb4d5d88ddb676c988672fa03ddc28a1027241a39b28ae',
  updated_at='2026-10-01'
WHERE entry_id='ARL-KB-007';
