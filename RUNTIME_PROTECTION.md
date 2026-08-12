# AgentRiskLayer Runtime Protection

AgentRiskLayer provides two runtime enforcement paths with different approval boundaries.

## Hosted Guard API

The hosted `POST /v1/guard` endpoint provides:

- project-scoped, immediately revocable API keys;
- prompt/input and model-output inspection;
- tool allowlists and denylists;
- filesystem path boundaries;
- network destination allowlists;
- secret-like argument blocking;
- exact-action human approvals issued by project admins or owners;
- atomic single-use approval consumption;
- idempotent request identifiers;
- policy version and digest binding;
- privacy-safe runtime and audit evidence;
- account-export and project-retention coverage for approval ledger records.

For an approval-required action, create the approval through the authenticated control plane. Send the returned one-time token with the exact tool call:

```json
{
  "request_id": "refund-demo-001",
  "tool_call": {
    "name": "refund_order",
    "arguments": {
      "orderId": "demo_order_4821",
      "amountPence": 17500,
      "currency": "GBP"
    },
    "approval_token": "server-issued-token"
  }
}
```

The Guard ignores caller-controlled `approved`, `humanApproved` and `productionApproved` booleans. The authenticated approver is recorded in the protected server ledger and audit trail, while the short-lived bearer token intentionally omits the internal approver identifier. The token must match the workspace, project, authoritative environment, tool and canonical argument digest. A different target or value is denied. Expired, revoked and replayed approvals are denied.

### Resolve material values before approval

Exact-action approval can bind only the values present in the guarded tool call. If an amount, target, destination, quantity or other material parameter is resolved by a downstream service after the Guard decision, the approval does not prove that the later value was approved.

For prepare/execute APIs, the prepare step should return a short-lived server-owned quote or commitment for the exact target and value. Include that commitment, and the resolved material fields when available, in the approved arguments. The execute step should accept only the same unexpired commitment and fail closed on stale or mismatched values.

Per-action approval is not an aggregate budget or quota control. Where cumulative exposure matters, enforce resource-, account- or tenant-level limits atomically in the authoritative downstream system or a separately reviewed budget service. Account for retries, idempotency and concurrent requests rather than assuming several individually valid actions satisfy an aggregate ceiling.

## Customer-operated local gateway

The local gateway is a narrow HTTP proxy for systems where runtime content must remain inside the customer environment. It enforces:

- tool allowlists and denylists;
- filesystem path boundaries;
- network destination allowlists;
- secret-like argument blocking;
- request and response size boundaries;
- input and output inspection;
- fail-closed behaviour;
- monitor-only rollout mode;
- redacted JSONL audit events containing hashes rather than raw arguments.

Start it with:

```bash
node runtime/agent-risk-runtime.mjs \
  --policy runtime/runtime-policy.example.json \
  --upstream http://127.0.0.1:3000 \
  --port 8787 \
  --audit runtime-audit.jsonl
```

Send `x-arl-tool-name` on each call, or include `tool` in the JSON body.

### Approval limitation

The local gateway does not contain the hosted PostgreSQL approval ledger and does not accept self-asserted approval booleans. Actions matched by `requireApprovalFor` fail closed in enforce mode. Use the hosted Guard API for AgentRiskLayer-issued, database-backed, single-use approvals, or integrate a separately reviewed customer approval service before enabling equivalent local high-impact actions.

## Security boundary

Protection applies only to traffic routed through the Guard API or local gateway. Direct connections to protected tools must be blocked with network controls, firewall rules or service authentication. Neither path replaces least privilege, sandboxing, secure tool design, independent testing, monitoring, rollback or recovery controls.
