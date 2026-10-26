# ARL -> Codex CLI local adapter (experimental)

## Scope of this integration

This is an **ARL Red Team Runner -> localhost adapter -> Codex CLI** transport path.
It does not replace the ARL operator workflow or add an alternative scoring engine.

Current support: **RT-PI-001 only**, as an initial plumbing check in a **fresh synthetic directory**.
No synthetic MCP tools are exposed, so tool/approval tests are intentionally refused.
The adapter never declares an ARL security PASS: every Codex JSONL stream is marked
`executionStatus: "unverified"` pending target-bound independent observations.
An ARL `failed` detector result is still only a candidate finding for human verification.

The endpoint uses the existing `arl.redteam.request.v1` /
`arl.redteam.response.v1` and `POST /agentrisklayer/evaluate` contract.

## Security boundaries

- Binds only to 127.0.0.1 and requires an operator-provided bearer token.
- Disabled unless `ARL_CODEX_EXECUTION_ENABLED=I_AUTHORISE_SYNTHETIC_CODEX_EXECUTION`.
- Requires a private 0700 synthetic lab with no symlinks/hardlinks.
- Rejects `~/agent-risk-layer` and `~/0din-lab-codex` as target labs.
- Uses `codex --ask-for-approval never exec --json --ephemeral --ignore-user-config
  --skip-git-repo-check --sandbox read-only -C <lab> -`.
- Hard bounds output size, request size, execution duration and concurrent sessions
  (one request at a time is intended; concurrency enforcement is a follow-up before live testing).
- Never logs raw prompts or stderr. Keeps target text local to the adapter.
- No real Codex execution was exercised in the initial automated tests.
- **WARNING**: Codex sandbox read-only, ephemeral mode and user-config ignore
  are NOT equivalent to OS-level confinement. Codex may still read other host
  files or use an authenticated cloud session. Do NOT enable live execution on
  a host containing sensitive files without an independently controlled sandbox.
  Current integration must not be presented as a validated 0DIN vulnerability test.

## Local development flow (not a live 0DIN instruction)

```sh
node --test tests/codex-cli-local-adapter.test.js
```

The tests use a **mock Codex event stream** and a loopback HTTP server. They do not
launch Codex or exercise its account authentication.

To validate live execution later, first configure OS-level isolation,
freeze the exact Codex binary/package identity, and obtain the correct
programme testing authorisation and active ARL Rules of Engagement. The runner
requires a valid `roe_...` identifier for adapter-backed campaigns.

## Limitations

- CLI event completion is not proof of sandbox containment, tool approval,
  filesystem integrity or network isolation.
- This transport cannot independently attest that Codex denied a request.
- The `systemPolicy` string is included as **ordinary prompt text**; it is not
  mapped to a privileged Codex system/developer message. Security conclusions
  from RT-PI-001 are therefore invalid without an appropriate trusted policy
  setup.
- Signed ARL bundle integrity does not mean independent target attestation.
- No ARL desktop UI integration, persistent Codex selection or human approval
  workflow has been implemented by this PR. It is a vertical CLI-only slice.
