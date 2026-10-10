# Offline operator evidence review dashboard

## One command to open the real local dashboard (Debian desktop)

After the canonical product repository has been updated and your existing PostgreSQL assessment is accessible:

```bash
cd ~/agent-risk-layer
npm run operator:open -- "$HOME/arl-target-mcp-agent"
```

This explicit local command fixes the request to `Export assessment operator dashboard`. It uses the **existing** frozen-target preflight, original assessment binding, evidence-trust calculations, and read-only report preparation before asking Linux to open the verified HTML with `xdg-open` (an argument array, not a shell command). The browser does not host a service or get permission to record decisions.

If the desktop opener is unavailable, the operator still receives the local HTML path. The shortcut checks the report's 64-character SHA-256 digest, filename, private file/directory permissions, and refuses symlinks. It does not bypass PostgreSQL availability, source SHA checks, authorisation or evidence review. It does not update `main` or the target automatically.

For an extra explicit SHA assertion, set `ARL_EXPECTED_TARGET_SHA` to the frozen Git commit before running. **Do not** use this command against a different target or an unapproved scope.

Command in the local owner-controlled AgentRiskLayer checkout:

```bash
ARL_EXPECTED_TARGET_SHA=<exact frozen commit SHA> ARL_AI_ADVISORY=0 \
npm run assess:local -- "$HOME/arl-target-mcp-agent" "Export assessment operator dashboard"
```

Requires the existing local PostgreSQL assessment and frozen target. The command uses the verified local runner and the authoritative control queue. It creates a version-specific `ARL-operator-review-<digest>.html` file in `data/local-reports/` (or the existing `ARL_REPORT_OUTPUT_DIR`). The console prints its exact local path. Open the HTML file directly in a browser; **no server, login screen or new network request is needed**.

The document is a **read-only preparation artifact**, not the authoritative security result. It displays only independently actionable test/evidence-stage controls, with current snapshot ID, frozen Git SHA, canonical criteria, source observations, recorded evidence/test metadata, and operator tasks. Blocked findings, closed/completed/human-decision controls are explicitly outside this view. Their status is not changed.


## Work the 98-control queue without treating it as 98 verdicts

The offline HTML now presents a **four-stage evidence work plan** before the complete control index:

1. Missing frozen-source observations — obtain version-specific inspection metadata and assess its provenance.
2. Human evidence and ownership — request accountable policy, scope, approval and reviewer records.
3. Separately authorised runtime checks — plan synthetic bounded positive and negative tests **outside** the HTML; never treat a plan as execution authority.
4. Source provenance exceptions — resolve stale or conflicting lineage before human evidence acceptance.

Each group shows the count of affected controls and requirement instances, with links to the exact canonical criteria in the individual control dossier. **A control can appear in several groups**; group counts are neither distinct controls nor finding counts. The full index is available in a collapsed no-script disclosure for quick lookup. All underlying evidence inventory and test metadata remain accessible. The dashboard performs no updates, executes no tests and cannot authorize release. A newly generated report is required after a material snapshot, source or trust change.

Safety requirements:
- Reject incomplete or inconsistent 108-control queue pages.
- Bind all dossier batches to one authoritative snapshot and exact frozen target Git revision, with original assessment binding.
- Require the frozen target to remain clean and unchanged before writing the HTML report, and re-read the work queue to reject a changed plan.
- Do not expose raw observed test payloads, source code, credentials or unredacted secrets; the report contains only bounded metadata and canonical requirement text.
- Escape all rendered text. No JavaScript, external assets or network connections; a restrictive Content Security Policy is set.
- The generated HTML filename is content-addressed, immutable, and created with owner-only mode `0600`. Existing content is reused, conflicting content is rejected.
- No `PASS`, `FAIL`, applicability or evidence verification, remediation closure, active test or deployment action may be inferred or recorded by this command.

The operator must conduct accountable reviews through the separately authorised ARL workflows after examining these dossiers. An old offline document must not be treated as evidence that the current system is safe to deploy.