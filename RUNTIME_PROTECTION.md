# AgentRiskLayer Runtime Gateway

Version 5.2.0 adds customer-operated runtime enforcement for HTTP-based agent
tool calls. It is a narrow gateway, not a claim that arbitrary code execution
is intercepted automatically.

## What it enforces

- tool allowlists and denylists;
- filesystem path boundaries;
- network destination allowlists;
- secret-like argument blocking;
- human approval for write, send, deploy, execute, payment and transfer actions;
- separate approval for production actions;
- request-size boundaries;
- fail-closed behaviour by default;
- monitor-only rollout mode;
- redacted JSONL audit events containing hashes, not raw arguments.

## Five-minute integration

1. Copy `runtime/runtime-policy.example.json` and edit the allowlists.
2. Start the customer's existing agent/tool HTTP service locally.
3. Start the gateway:

   ```bash
   node runtime/agent-risk-runtime.mjs \
     --policy runtime/runtime-policy.example.json \
     --upstream http://127.0.0.1:3000 \
     --port 8787 \
     --audit runtime-audit.jsonl
   ```

4. Point the agent's tool base URL to `http://127.0.0.1:8787`.
5. Send `x-arl-tool-name` on each call, or include `tool` in the JSON body.
6. For approved material actions, include:

   ```json
   {
     "runtimeContext": {
       "humanApproved": true,
       "environment": "production",
       "productionApproved": true
     }
   }
   ```

Start with `"mode": "monitor"` to measure false positives. Move to
`"mode": "enforce"` only after reviewing the audit stream.

## Security boundary

The gateway protects requests that are actually routed through it. Direct
connections to the upstream service must be blocked with network policy,
firewall rules or service authentication; otherwise an agent could bypass the
gateway. The gateway binds to loopback by default and never uploads raw
arguments.
