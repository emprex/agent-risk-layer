# AgentRiskLayer control-plane and Guard API

## Authentication

Control-plane browser/API routes use the authenticated account session and CSRF protection. The hosted runtime endpoint uses a project API key:

```http
Authorization: Bearer arl_live_<prefix>_<secret>
```

A key is shown once, stored only as a SHA-256 hash and can be revoked immediately. Use separate keys per environment and integration. Never place a key in browser code, URLs, logs or source control.

## `POST /v1/guard`

Maximum JSON body: 1 MiB.

```json
{
  "request_id": "stable-caller-generated-id",
  "input": "optional user or retrieved content",
  "output": "optional model output",
  "context": ["optional bounded context strings"],
  "tool_call": {
    "name": "payments.create",
    "arguments": {"amount_pence": 2500, "recipient_id": "supplier-7"},
    "approved": false,
    "approval_token": "optional transaction-bound approval"
  },
  "metadata": {"agent": "billing-agent", "trace_id": "trace-102"}
}
```

At least one of `input`, `output` or `tool_call` must be supplied. `request_id` must be stable for a logical operation.

Example response:

```json
{
  "requestId": "stable-caller-generated-id",
  "decision": "deny",
  "mode": "enforce",
  "blocked": true,
  "replayed": false,
  "reasons": ["High-impact tool requires approval"],
  "matchedRules": ["ARL-RUNTIME-APPROVAL"],
  "eventId": "evt_...",
  "policyVersion": 3,
  "usage": {"used": 124, "limit": 50000, "remaining": 49876}
}
```

Response headers:

- `X-AgentRisk-Decision: allow|deny|monitor`
- `X-AgentRisk-Request-Id: <request_id>`
- `Retry-After: 60` on rate limiting

## Semantics

- **Enforce:** a denied decision returns HTTP 200 with `blocked: true`; the caller must not execute the affected model output or tool action.
- **Monitor:** policy violations are recorded, but `blocked` is false. Use only during controlled observation.
- **Replay:** repeating the same project/key/request ID returns the original decision and does not consume the monthly allowance twice.
- **Fail closed:** a production caller should treat network errors, 401, 403, 409, 429 and 5xx responses as a blocked or human-review state for high-impact actions.
- **Timeouts:** use a bounded client timeout and no automatic fallback to unprotected execution.

## Status codes

- `200` — decision returned
- `400` — invalid request or policy input
- `401` — missing, malformed, expired or revoked key
- `403` — key/project not permitted
- `409` — conflicting replay or project state
- `413` — body exceeds 1 MiB
- `429` — burst or plan limit reached
- `5xx` — service unavailable; fail closed for sensitive actions

## Privacy

The service does not retain raw input, output, context or tool arguments. Stored evidence is limited to decisions, rule IDs, digests, tool name, bounded customer metadata, policy/project references and timestamps. Avoid submitting unnecessary personal data or live secrets. Use the local runtime gateway where hosted content processing is not acceptable.

## Project policy

Policies support:

- monitor or enforce mode;
- input, output and secret checks;
- allowed and denied tool names;
- approved network destinations;
- approval-required tools/actions;
- versioning and audit history.

Production, staging and test projects default to enforce mode. Development defaults to monitor mode.

## Inventory and remediation APIs

Authenticated routes under `/api/projects/:projectId` provide:

- `/keys` — issue/list/revoke project keys;
- `/events` — list privacy-safe runtime decisions;
- `/inventory` — create and compare asset snapshots;
- `/remediations` — create, assign, update and verify remediation work;
- project policy/status updates and audit history.

The browser control plane at `/control-plane.html` exercises these same server-enforced contracts.
