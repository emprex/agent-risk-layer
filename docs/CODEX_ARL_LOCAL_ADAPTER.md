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

## Operator connectivity check (not a vulnerability test)

The local Operator now offers option **6**, `Codex CLI research target`.
The operator selects a **new 0700 synthetic directory**, chooses `CONNECT`,
and must type `I AUTHORISE CODEX CONNECTIVITY` exactly.
Only then does ARL launch `codex exec` using the fixed benign prompt
`ARL_CODEX_CONNECTED`. The CLI uses configured authentication and may make
provider API requests. This is not an offline test.

The CLI output is parsed in memory, **never written as a transcript**.
ARL saves a private 0600 receipt below `~/ARL-Assessments/codex-connectivity-*/receipt.json`.
It contains a trace hash, bounded event metadata, process exit status and the
explicit verdict `not_assessed`; it cannot become a security finding.
A successful connectivity receipt **does not** demonstrate operating-system
confinement, trustworthy policies, secured MCP permissions or safe tool behavior.

Do not use the historical `~/0din-lab-codex` or `~/agent-risk-layer`
as target directories. This benign smoke does not use the active Red Team
authorisation path because it runs **no adversarial tests**.
Any eventual adversarial 0DIN evaluation must use the existing ARL human ROE,
frozen target identity, bounded Red Team gates and independent observations.

## Offline Bubblewrap namespace preflight

Under Operator option 6, choose **ISOLATION** after providing a clean 0700
synthetic lab. The host runs only a short-lived shell inside a Bubblewrap
sandbox, NOT the Codex CLI. It requires /usr/bin/bwrap on Linux; installation
alone is not proof that namespace creation works on the host kernel.

The preflight requests a separate user, PID, IPC and **network** namespace,
and a minimal synthetic mount root. The only host directory deliberately
made available is /usr (read-only); the selected synthetic lab is bound
read-only to /workspace. On Debian 13's merged-/usr layout, Bubblewrap
also reconstructs /bin, /lib and /lib64 as symlinks pointing into that
read-only /usr mount. These are required for /usr/bin/sh to find its ELF
loader; omission can yield a misleading 'execvp: No such file or directory'.
No home, ARL repository, account data, or host root is mounted.
The preflight compares kernel-provided network and mount namespace
identifiers and checks that a temporary host canary is not visible from inside
the sandbox.

A private 0600 receipt is saved under the ARL Assessments directory.
Possible statuses: `namespace_probe_passed` and `isolation_unverified`.
Both explicitly retain `securityVerdict:not_assessed` and
`independentIsolationAttested:false`. A namespace probe does not demonstrate
the security of a later, differently configured online Codex process or
verify that the user namespace restrictions, filesystem policy or network
allowlist used in an actual 0DIN campaign are adequate.

**Do not reuse the offline profile to execute online Codex directly**:
network unsharing prevents normal model-provider access. A future authorised
online assessment requires a separately reviewed egress/authentication design
and OS-level evidence about the *actual* Codex process.

## Offline Codex native-binary smoke (new Operator mode BINARY)

Choose option **6**, enter the private 0700 synthetic lab, then select **BINARY**.
This mode resolves the installed `@openai/codex` npm launcher (Linux x64),
selects the single native Codex binary from its installed platform package,
copies it to a temporary 0700 directory, computes its SHA-256, and binds
only that snapshot into Bubblewrap read-only as `/app/codex`.

The Bubblewrap sandbox retains the working ISOLATION namespace flags,
unshares the network, exposes only read-only `/usr`, the same merged-/usr
link fix, `/proc`, `/dev`, `/tmp`, the synthetic lab read-only at
`/workspace`, and the native binary snapshot at `/app/codex`.
The environment is cleared and explicitly sets an empty temporary
`HOME` and `CODEX_HOME` under a tmpfs. **No ~/.codex, npm installation
tree, model credentials, local project files or host filesystem root are
mounted.** The command inside the namespace is exactly
`/app/codex --version`, preceded by a bounded shell check of the network
and mount namespace identifiers and a host canary.

Version output must match the expected `codex-cli X.Y.Z` shape and the
namespace IDs must differ from those of the parent process. The binary
snapshot is removed in a finally block. Operator records a 0600 receipt
under `~/ARL-Assessments/codex-offline-*/receipt.json` containing the
snapshot digest and a `not_assessed` verdict. Tests with synthetic
binaries are injected in CI; they **do not** execute the real Codex binary.

**Limitations:** this verifies only a version command from a native
executable under an offline sandbox. It does not exercise the actual
agent's permissions, authentication, network/API policy, tools, MCP,
prompt handling, or any 0DIN research scenario. Only one known npm
Linux x64 package layout is supported; other layouts fail closed.
Do not confuse this bounded demonstration with confinement of a full
online agent or readiness for client assessment.

## Synthetic offline agent protocol smoke (Operator mode AGENT)

Operator option **6 → AGENT** executes a REAL native Codex `exec` turn
inside the same offline Bubblewrap namespace as a fixed Python Responses
API mock server (`127.0.0.1:18787/v1`). This is a deterministic protocol
fixture, **not a real LLM**. It returns only `ARL_LOCAL_FIXTURE_OK` and no
tool calls. The loopback server only accepts bounded POST requests to
`/v1/responses` and records a local marker inside `/scratch`.

Bubblewrap unshares the network so neither process can reach the host
loopback, the user's Ollama instance, the internet, or a model provider.
The runner copies only the native Codex executable and the fixture script
into a temporary private staging area, mounts both read-only under `/app`,
clears environment variables, and points HOME/CODEX_HOME into ephemeral tmpfs.
It does not mount user auth, Node/npm installation directories, the host
home, previous 0DIN labs or real client data.

The CLI invocation on Codex 0.164.0 places `--ignore-user-config` after
`exec`, not before. The previous ordering failed at argument parsing with
exit code 2 (`unsupported_cli_option`) before any local HTTP request;
unit tests now enforce the corrected argument order. The mock provider is
explicitly `requires_openai_auth = false`, never mounting API credentials.

A bounded shell runs the mock server, checks its readiness, invokes Codex
with `--ignore-user-config`, a fixed custom local Responses provider,
`--sandbox read-only`, `--json`, and `--ephemeral`, then validates the
Codex JSONL completion and exact synthetic fixture token inside the
namespace. Raw Codex prompts and output stay in the sandbox tmpfs and
are never persisted as evidence. Both kernel namespace identifiers and
the synthetic server contact marker must be present for
`offline_agent_fixture_observed`; otherwise the receipt is
`offline_agent_fixture_unverified`. If unverified, the receipt also records
only bounded diagnostic enums (`diagnosticStage`, `fixtureRequestState`,
`codexErrorCategory`) and a numeric in-sandbox process exit code. The
fixture stores a fixed, non-sensitive enum for rejected HTTP requests.
Raw HTTP payloads, stderr, Codex output and JSONL traces remain inside
sandbox tmpfs and are not copied to the receipt. The absence of a validated
fixture contact is not by itself evidence that *no* HTTP request was made.

This mode writes a private `0600` receipt under
`~/ARL-Assessments/codex-agent-fixture-*/receipt.json`, with hashes for
the native binary and fixture, no authorising or closure decision, and
`securityVerdict: not_assessed`. Tests in GitHub CI use a mocked runner;
the real `AGENT` mode must be independently verified on the user's Debian.

**Not validated by AGENT:** external API/network allowlisting, credentials,
MCP or approval barriers, hostile prompts, dynamic model reasoning,
OS confinement of an online process, client systems, or 0DIN findings.
A future online model must have its own separately audited network and
credential design. Do not reuse this fixture receipt as a real security
assessment or independent full-isolation certificate.

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
