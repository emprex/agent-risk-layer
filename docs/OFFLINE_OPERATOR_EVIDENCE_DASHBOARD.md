# Offline operator evidence review dashboard

Command in the local owner-controlled AgentRiskLayer checkout:

```bash
ARL_EXPECTED_TARGET_SHA=<exact frozen commit SHA> ARL_AI_ADVISORY=0 \
npm run assess:local -- "$HOME/arl-target-mcp-agent" "Export assessment operator dashboard"
```

Requires the existing local PostgreSQL assessment and frozen target. The command uses the verified local runner and the authoritative control queue. It creates a version-specific `ARL-operator-review-<digest>.html` file in `data/local-reports/` (or the existing `ARL_REPORT_OUTPUT_DIR`). The console prints its exact local path. Open the HTML file directly in a browser; **no server, login screen or new network request is needed**.

The document is a **read-only preparation artifact**, not the authoritative security result. It displays only independently actionable test/evidence-stage controls, with current snapshot ID, frozen Git SHA, canonical criteria, source observations, recorded evidence/test metadata, and operator tasks. Blocked findings, closed/completed/human-decision controls are explicitly outside this view. Their status is not changed.

Safety requirements:
- Reject incomplete or inconsistent 108-control queue pages.
- Bind all dossier batches to one authoritative snapshot and exact frozen target Git revision, with original assessment binding.
- Require the frozen target to remain clean and unchanged before writing the HTML report, and re-read the work queue to reject a changed plan.
- Do not expose raw observed test payloads, source code, credentials or unredacted secrets; the report contains only bounded metadata and canonical requirement text.
- Escape all rendered text. No JavaScript, external assets or network connections; a restrictive Content Security Policy is set.
- The generated HTML filename is content-addressed, immutable, and created with owner-only mode `0600`. Existing content is reused, conflicting content is rejected.
- No `PASS`, `FAIL`, applicability or evidence verification, remediation closure, active test or deployment action may be inferred or recorded by this command.

The operator must conduct accountable reviews through the separately authorised ARL workflows after examining these dossiers. An old offline document must not be treated as evidence that the current system is safe to deploy.