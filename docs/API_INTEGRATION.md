# Risk knowledge API contract — ARL-RKA-1.2.0

This contract describes the implementation in this repository. It reuses the existing session, verified-email, CSRF, workspace/project-role, audit, rate-limit, retention and error-handling paths. It does not create a parallel identity, findings or evidence system.

## Public-safe routes

### `GET /api/risk-knowledge`

Query fields: `query`, `category`, `severity`, `framework`, `owner`, `validationStatus`, `testMode`, `automationStatus`, `sort`, `limit`, `offset`.

Returns `items`, compatibility alias `entries`, `total`, `limit`, `offset`, `hasMore`, dynamic filter options with counts, and `knowledgeVersion`. The maximum page size is 250. Search covers ID, title, category, problem, remediation and framework names/references.

Returns active entries with public problem information, category, default severity, high-level owner/remediation summary, operational classification and informative mappings. It does not return exact check methods, required evidence, pass/fail criteria, retest acceptance or project evidence. The response is versioned and publicly cacheable for five minutes.

### `GET /api/risk-knowledge/:id`

Returns one public-safe entry by ID or slug. Missing entries return 404.

### `POST /api/risk-knowledge/profile`

Body:

```json
{
  "facts": {
    "uses_tools": true,
    "processes_personal_data": null
  }
}
```

The global CSRF control applies. The route accepts only known architecture fact keys with values `true`, `false` or `null` and is rate-limited. Null or omitted facts remain unknown and include the entry for review. Public profile answers are not retained.

The browser fallback `public/risk-knowledge-public-v1.1.json` contains no exact checks or pass/fail criteria. It includes structured applicability predicates so the public explorer and profiler can degrade safely during a bounded API outage.

## Verified-account detail and exports

### `GET /api/risk-knowledge/:id/detail`

Requires an authenticated account with a verified email. Returns exact check method, required evidence, pass/fail criteria, remediation and retest acceptance. Responses are `no-store` through the shared JSON helper.

No paid entitlement is asserted in this release. Introducing a paid boundary is a commercial decision and must reuse the existing server-side entitlement service rather than a client-only restriction.

### `GET /api/risk-knowledge/:id/export?format=json|yaml|rego`

Requires an authenticated account with a verified email.

- JSON and YAML include the knowledge version, entry digest, limitations and control manifest.
- Rego returns 409 unless the entry has a reviewed executable rule, `machine_rule_status='verified'`, and Rego export is explicitly enabled.
- No entry in ARL-RKA-1.2.0 is represented as having a verified machine rule or verified automation.

### `GET /api/risk-knowledge-predicates`

Returns the authoritative 66-predicate registry, including provenance classification, dependencies, conditional-display rules and the justification for facts that require observation, metadata or manual review.

## Project workflow

### `PUT /api/projects/:projectId/risk-knowledge-profile`

Requires a verified user with project `developer`, `admin` or `owner` access.

Accepted body:

```json
{ "facts": { "uses_tools": true, "is_production": true } }
```

The server resolves the project and workspace, validates all facts, hashes the canonical architecture profile, evaluates all 108 entries and upserts project applicability state. Existing evidence state and reason are preserved. Caller-supplied workspace/user IDs, manual applicability, evidence counts, critical flags or deployment gates are rejected.

### `GET /api/projects/:projectId/risk-knowledge-readiness`

Requires an authenticated verified user with access to the exact project. Returns per-entry applicability, evidence state, live evidence-link count and server-derived gate, plus aggregate Evidence Readiness.

This is not a certification, breach probability or checkbox compliance score. A critical open finding can produce `do_not_deploy` and is not averaged away by passing lower-impact controls.

### `POST /api/projects/:projectId/risk-knowledge-links`

Requires a verified project `admin` or `owner`.

Accepted fields: `subjectType`, `subjectId`, `entryId`, `linkRole`.

The server resolves the subject through `resolveRiskKnowledgeSubject` and verifies exact project/workspace ownership before storing the versioned knowledge link. Caller-supplied workspace/user IDs are rejected. Unsupported or not-yet-project-bound subject types fail closed.

Currently supported authoritative subjects:

- `runtime_event`
- `approval`
- `remediation`
- completed and passed `retest`
- active `evidence_artifact` with a live source
- exact project-scoped `assessment_finding` represented by a remediation finding key

The current repository does not yet expose authoritative project-bound records for `inspection_finding`, `redteam_case` or `deployment_decision`; attempts to link them fail closed.

### `PUT /api/projects/:projectId/risk-knowledge/:entryId/state`

Requires a verified project `admin` or `owner`.

Accepted fields: `architectureFacts`, `evidenceState`, `stateReason`.

The service validates transitions, derives applicability, counts authoritative links, verifies the required evidence type and derives the deployment gate. Do **not** accept `deploymentGate`, `criticalGateFailed`, `evidenceCount`, workspace ID or user ID from the request body. The server-side resolver fails closed for unsupported subjects, cross-project subjects and missing authoritative evidence.

## Evidence semantics

- `observed`: linked `inspection_finding` or active `evidence_artifact`.
- `test_passed`: linked project-bound `inspection_finding` or `redteam_case`. This transition is intentionally unavailable until those records become project-bound in this repository.
- `finding_open`: linked `assessment_finding`, `inspection_finding`, `redteam_case` or `runtime_event`.
- `remediation_in_progress`: linked `remediation`.
- `retest_passed`: linked completed, passed and runtime-bound `retest` whose event records `retest_satisfied=1` for the exact criteria.
- `risk_accepted`: linked project-bound `deployment_decision`. Runtime action approval is not risk acceptance, so this transition is intentionally unavailable in this repository version.

Generic implementation evidence is not proof that a test passed. Runtime approval of one exact action is not approval of the project’s residual security risk.

## Retention, export and deletion

- Runtime retention removes risk links before deleting source events.
- Runtime-sourced evidence artefacts are invalidated when their source expires.
- Observed/test/retest/risk-acceptance states become `expired` when their required evidence disappears.
- An open finding is not silently cleared merely because its event record reached retention expiry.
- Account export includes project risk states and links with knowledge version and digest.
- Project/workspace deletion cascades risk state and links; user deletion nulls reviewer/creator references where projects are preserved.

## Mandatory negative tests

The integrated test set covers public/full content separation, unauthenticated detail, unverified/low-role writes, CSRF, cross-workspace project access, caller-supplied gate/count fields, unsupported subjects, duplicate links, missing evidence, invalid state promotion, action-approval/risk-acceptance separation, retest integrity, retention expiry, unsupported Rego export and account export.
