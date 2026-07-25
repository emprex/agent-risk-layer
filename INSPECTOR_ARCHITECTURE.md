# AgentRisk Inspector architecture and threat model

## Objective

Improve assurance beyond self-declared questionnaire answers without requiring customers to upload source code, credentials or proprietary datasets.

## Components

### 1. Official single-file scanner

- Node 22, no third-party packages
- Reviewable source
- Read-only traversal of regular files
- Symbolic links are not followed
- Common dependency, build and VCS directories are excluded
- Bounded file count, file size and total bytes read
- No exploitation, port scanning, model calls or cloud API calls
- Network access occurs only when the customer explicitly supplies `--upload`

### 2. Policy engine

Rules are deterministic and published. Each result contains:

- Stable rule identifier
- Severity and confidence
- Category
- Human-readable observation
- Remediation
- Framework mappings
- Redacted evidence references

Static heuristics can be wrong. Confidence is therefore explicit, and accepted-risk reviews remain visible with owner and expiry.

### 3. Evidence bundle

Schema: `arl.inspection.bundle.v1`

The bundle contains scanner metadata, scan scope, subject fingerprint, summary, findings, technology inventory, privacy attestations and a trust-boundary statement.

Integrity process:

1. Canonicalise all payload keys.
2. Calculate SHA-256.
3. Sign canonical bytes using Ed25519.
4. Embed the public key, signature and digest.
5. Server recalculates and verifies all values.

The default signing key is ephemeral. Customers can use `keygen` and `--key` to maintain a stable local signing identity. AgentRiskLayer does not treat the customer key as an independent identity credential.

### 4. Published release digest comparison

The scanner reports a normalized SHA-256 digest of its own source file. The server compares that value with the scanner release it currently publishes.

This catches ordinary version mismatch, accidental editing and stale downloads. It is **not remote attestation**: a hostile operator who controls the machine and crafts a custom bundle could report the published digest. Reports therefore describe this as a release-digest match, not proof that unmodified code executed. Stronger independent assurance requires a server-side source-control connector, controlled runner, hardware-backed attestation or human custody.

### 5. One-time upload protocol

1. Authenticated user chooses a private assessment.
2. Server creates a random token.
3. Only an HMAC hash is stored.
4. Token expires after 15 minutes.
5. CLI submits the bundle with `Authorization: Bearer scan_...`.
6. Server binds the accepted scan to the token's user and assessment.
7. Token is marked used in the same database transaction as the inspection insert.
8. Bundle digest uniqueness blocks replay through another token.

### 6. Data storage

Stored inspection data is already redacted and bounded. It includes:

- Subject and scan scope
- Summary and technology names
- Findings and evidence references
- Integrity and release-verification metadata
- Delta from the previous scan

Account export includes scans. Account or assessment deletion cascades to scan tokens and inspection records.

## Threats and mitigations

| Threat | Mitigation | Residual limitation |
|---|---|---|
| Source-code leakage | No file content in bundle; schema rejection for raw-content keys | Rule facts and basenames can still reveal limited metadata |
| Secret leakage | Match values replaced by a non-correlating per-scan HMAC fingerprint; server rejects secret-like payloads | Novel secret formats may not be recognised by rejection filter |
| Upload replay | One-time token plus unique bundle digest | Compromised authenticated account can request new tokens |
| Bundle tampering | SHA-256 and Ed25519 verification | Customer controls the signing environment |
| Scanner mismatch | Reported release digest is compared with the published scanner | This is not remote attestation and cannot prove which code executed on a customer-controlled machine |
| Oversized payload | 2 MB body limit, count limits and bounded strings | Intentional many-small-item abuse remains rate-limited rather than impossible |
| Cross-account scan attachment | Token is bound to user and assessment | Account takeover defeats account-level boundary |
| Unsafe scanner execution | No dependencies, no eval, no target code execution, no symlink following | Scanner still parses attacker-controlled text and should run as an unprivileged user |
| False assurance | Declared and observed risk remain separate; scan never lowers declared risk automatically | Static analysis cannot prove runtime controls or business process effectiveness |
| Scope manipulation | User exclusions and truncation recorded in scope and downgrade assurance label | A customer can omit an entire repository that the service does not know exists |

## Scanner limitations

The inspector does not currently:

- Clone repositories
- Authenticate to cloud providers
- Inspect production network controls
- Execute dependency vulnerability databases
- Run SAST data-flow analysis
- Test prompts or tool calls dynamically
- Observe runtime behaviour
- Verify deployed artifact provenance
- Confirm organisation ownership

These are future connector and runtime-assurance milestones, not hidden capabilities.

## Version 3.1 review precision

Named false-positive reviews remain visible in the signed evidence bundle but are excluded from active technical-risk scoring. Each review requires a reason, owner and expiry. Expired reviews automatically stop matching. Public static image/SVG wildcard CORS is treated separately from credentialed or application-route wildcard CORS to reduce low-value noise without hiding material web findings.
