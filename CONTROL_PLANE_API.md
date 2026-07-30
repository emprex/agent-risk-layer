# AgentRiskLayer control-plane and Guard API

## Authentication

Control-plane browser/API routes use the authenticated account session, verified email and CSRF protection. The hosted runtime endpoint uses a project API key:

```http
Authorization: Bearer arl_live_<prefix>_<secret>
```

A project key is shown once, stored only as a SHA-256 hash and can be revoked immediately. Use separate keys per environment and integration. Never place a key in browser code, URLs, logs or source control.

## Guided browser protection check

`POST /api/projects/:projectId/guided-protection-check` is an authenticated browser workflow for project `admin` and `owner` roles. It runs four fictional checks through the same hosted policy and approval engine without requiring a project API key or terminal command:

1. missing approval must be denied;
2. changed amount must be denied;
3. the exact approved action may be allowed once;
4. the same approval reused under a new request ID must be denied.

The route creates a short-lived exact-action approval internally, never returns the bearer token and never calls an external customer tool. Each run consumes four of the project’s monthly protection checks. Events are recorded as `guided_demo` evidence and are deliberately excluded from the current-policy deployment-readiness journey. The response states that the check is synthetic and does not prove customer integration.

## Issue an exact-action approval

`POST /api/projects/:projectId/approvals` requires an authenticated project `admin` or `owner`.

```json
{
  "ttlSeconds": 600,
  "toolCall": {
    "name": "refund_order",
    "arguments": {
      "orderId": "demo_order_4821",
      "amountPence": 17500,
      "currency": "GBP"
    }
  }
}
```

The server canonicalises the action and binds the approval to:

- workspace;
- project;
- authoritative project environment;
- exact tool identity;
- the SHA-256 digest of every argument;
- issue and expiry timestamps.

The authenticated approver identity is recorded in the server-side approval ledger and audit trail. It is intentionally omitted from the bearer token so decoding the token does not expose an internal user identifier.

The returned token is shown once. Only its SHA-256 digest is stored. The approval can be listed or revoked through:

- `GET /api/projects/:projectId/approvals`;
- `POST /api/projects/:projectId/approvals/:approvalId/revoke`.

## `POST /v1/guard`

Maximum JSON body: 1 MiB.

```json
{
  "request_id": "stable-caller-generated-id",
  "input": "optional user or retrieved content",
  "output": "optional model output",
  "tool_call": {
    "name": "refund_order",
    "arguments": {
      "orderId": "demo_order_4821",
      "amountPence": 17500,
      "currency": "GBP"
    },
    "approval_token": "server-issued exact-action token"
  },
  "metadata": {"agent": "support-agent", "trace_id": "trace-102"}
}
```

At least one of `input`, `output` or `tool_call` must be supplied. `request_id` must be stable for a logical operation.

The Guard does not trust caller-supplied `approved`, `humanApproved` or `productionApproved` booleans. For approval-required actions it verifies the signed token against the current workspace, project, environment, tool and canonical argument digest, then atomically consumes the approval with the allowed runtime event.

Example response:

```json
{
  "schema": "arl.guard.response.v1",
  "requestId": "stable-caller-generated-id",
  "decision": "allow",
  "observedDecision": "allow",
  "approval": {
    "required": true,
    "status": "consumed",
    "approvalId": "apr_...",
    "actionDigest": "sha256...",
    "singleUse": true
  },
  "evidence": {
    "tool": "refund_order",
    "argumentDigest": "sha256...",
    "rawArgumentsRetained": false
  }
}
```

Response headers:

- `X-AgentRisk-Decision: allow|deny`;
- `X-AgentRisk-Request-Id: <request_id>`;
- `Retry-After: 60` on rate limiting.

## Approval failure semantics

- Missing, malformed, unknown or parameter-mismatched approval: deny with `ARL-RUN-009`.
- Expired or revoked approval: deny with `ARL-RUN-011`.
- Approval reused by another request: deny with `ARL-RUN-012`.
- A repeated identical `request_id` returns the original decision and does not consume a second allowance or approval.
- An approval is consumed only when the exact action otherwise passes policy and is allowed.

## Runtime semantics

- **Enforce:** a denied decision returns HTTP 200 with `decision: "deny"`; the caller must not execute the affected model output or tool action.
- **Monitor:** policy violations are recorded as `would-deny`, but the request returns `allow`. An approval is not consumed for a would-deny result.
- **Replay:** repeating the same project/request ID returns the original decision and does not consume the monthly allowance twice.
- **Fail closed:** callers should treat network errors, 401, 403, 409, 429 and 5xx responses as blocked or human-review states for high-impact actions.
- **Timeouts:** use a bounded client timeout and no automatic fallback to unprotected execution.

## Privacy

The service does not retain raw input, output, context or tool arguments in runtime evidence. Stored evidence is limited to decisions, rule IDs, cryptographic digests, tool name, approval identifiers, bounded customer metadata, policy/project references and timestamps. Approval tokens and project API keys are stored only as hashes. The signed approval bearer token does not contain the internal approver identifier; authenticated approver identity is retained only in the protected ledger and audit trail. Approval ledger records are included in authenticated account exports and are removed under the project retention policy after their terminal or expired timestamp. If an approver deletes their account while a shared project is retained, the user reference is removed and any still-active token fails ledger verification.

Avoid submitting unnecessary personal data or live secrets. Use the local runtime gateway where hosted content processing is not acceptable.

## Customer-operated gateway limitation

The downloadable local gateway enforces tool, path, host, secret and content rules inside the customer environment. It deliberately does not trust caller-supplied approval booleans. In this release, server-issued, database-backed, single-use human approvals are available through the hosted Guard API only. Approval-required local-gateway actions therefore fail closed unless routed through an independently implemented and reviewed customer approval service.

## Project policy

Policies support:

- monitor or enforce mode;
- input, output and secret checks;
- allowed and denied tool names;
- approved network destinations;
- approval-required tools/actions;
- versioning and audit history.

Production, staging and test projects default to enforce mode. Development defaults to monitor mode.
