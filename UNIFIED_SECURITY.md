# Unified security controls

AgentRiskLayer v5.3.0 evaluates four connected security planes:

1. **Input:** deterministic prompt-injection, extraction, role-spoofing,
   obfuscation and tool-policy-bypass patterns.
2. **Action:** tool identity, allowlists, destinations, paths, secret-bearing
   arguments, environment and human approval.
3. **Output:** secret-like values, private keys, payment-card-like values,
   hidden-instruction disclosure and unsafe network instructions.
4. **Supply chain:** immutable model digest, HTTPS source, publisher allowlist,
   licence declaration, executable content and unsafe serialisation.

Runtime decisions store a digest, size, rule identifiers and disposition without
retaining raw prompt, response or tool arguments. Events can be exported as CEF
or OCSF for ingestion by compatible security systems.

Workspace permissions are deny-by-default and scoped to the workspace identity.
Supported roles are viewer, analyst, developer, admin and owner. Approval
evidence can be HMAC-signed, expiry-bound and tied to the exact action digest,
workspace and environment.

These controls only protect routed and inspected traffic. Deployments must
remove direct upstream access and preserve TLS, authentication, network
segmentation and operational monitoring.
