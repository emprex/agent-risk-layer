# AgentRiskLayer 4.0 — Controlled Red-Team Architecture

## Purpose

AgentRiskLayer 4.0 adds customer-operated adversarial testing to the existing assessment and static-inspection platform. The objective is to reproduce unsafe AI-agent behaviour without turning the hosted service into an arbitrary-target scanner.

The runner is intentionally restricted to:

- built-in simulation;
- localhost;
- customer-authorised test or staging adapters;
- synthetic canaries and records;
- dry-run tools;
- sequential requests with bounded time, output and action counts.

It refuses production environment mode and destructive execution.

## Components

1. **Assessment service** — captures declared exposure, controls and evidence confidence.
2. **Local Inspector** — collects redacted static configuration evidence.
3. **Red Team Runner** — sends controlled adversarial cases to a simulator or customer staging adapter.
4. **Evidence intake** — verifies release digest, bundle age, Ed25519 signature, SHA-256 digest, safety attestations, one-time token and replay status.
5. **Risk correlation** — combines declared risk, static observations and reproduced behaviour without allowing a passing test to lower unresolved declared risk.
6. **Professional report** — records scope, case outcomes, remediation, framework mappings, limitations and retest deltas.

## Trust boundaries

### Customer boundary

The customer controls the system under test and the adapter. The customer is responsible for authorisation, environment isolation, synthetic data and dry-run downstream tools.

### Runner boundary

The runner contains a public case catalogue and deterministic detectors. It does not execute customer tool calls, shell commands or target code. Adapter credentials are read from a local environment variable and are never included in the bundle.

### Hosted service boundary

The hosted service receives only redacted results and fingerprints. It does not receive raw prompts, raw model responses, customer credentials, source files or tool arguments.

### Integrity boundary

Each run uses an ephemeral Ed25519 key pair. The service validates the signed SHA-256 digest and the runner-release digest. This proves bundle integrity after generation; it does not independently attest the customer machine, adapter implementation or completeness of test coverage.

## Abuse prevention

- production environment labels are rejected by the runner and server;
- remote targets require HTTPS; HTTP is limited to localhost;
- credentials in endpoint URLs are rejected;
- redirects are rejected;
- campaign uploads require short-lived one-time tokens;
- token claims are atomic and replay protected;
- bundles older than 24 hours are rejected;
- raw transcript keys, secret-like values and oversized fields are rejected;
- result scoring is recalculated server-side;
- simulation evidence is labelled and cannot change the deployment decision;
- only staging-adapter evidence can influence a deployment recommendation;
- Professional one-off reports include two runs; Developer and Agency plans receive rolling allowances.

## Test catalogue

The first policy version includes sixteen cases across:

- direct and indirect prompt injection;
- Unicode/delimiter obfuscation;
- system-policy disclosure;
- synthetic secret exfiltration;
- unauthorised email, destructive, shell and network actions;
- persistent-memory poisoning and cross-tenant access;
- poisoned MCP/tool descriptions;
- structured-output validation;
- role/authority confusion;
- runaway iterations and denial-of-wallet conditions.

## Non-goals

Version 4.0 does not:

- attack production systems;
- run destructive payloads;
- discover or scan arbitrary internet endpoints;
- bypass authentication;
- execute shell, SQL, SSRF or malware payloads;
- retain raw red-team transcripts;
- claim independent penetration testing or certification;
- prove that production is identical to staging.

## Future expansion gates

Before adding cloud-hosted connectors or runtime enforcement, complete:

- independent penetration testing;
- external rule and methodology review;
- formal release signing and key custody;
- production backup/restore exercises;
- legal review of testing authorisation and data processing;
- connector-specific least-privilege threat models;
- formal incident response and abuse handling.

## Version 4.1 authorisation enforcement

Staging evidence is accepted only when all of the following match:

- a live, non-revoked Rules of Engagement record;
- the authenticated assessment owner;
- the assessment ID;
- the issued one-time token mode (`staging`);
- the campaign authorisation ID;
- the approved environment;
- the approved endpoint origin when a remote staging origin is recorded;
- an active testing window.

The catalogue contains 32 cases. Each case can run 1-5 times. Repeated trials support stability evidence and pass-rate reporting; they do not increase the authorised scope or prove security beyond the selected cases.
