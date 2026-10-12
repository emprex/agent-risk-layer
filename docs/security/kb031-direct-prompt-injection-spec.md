# KB-031 — Direct prompt injection and external authorization boundaries

Status: **candidate design only**, requiring human review. No customer PASS/FAIL; no active target testing or change to the signed canonical record.

## Exact risk and trust boundary
KB-031 addresses a **direct user-input prompt injection** that attempts to make the agent disregard higher-priority operating constraints, reveal unauthorized data, or request forbidden tools. This is distinct from indirect injection through retrieved pages, MCP tool responses or documents. A model's refusal or compliance is an observation, **not** a deterministic authorization decision. An authenticated user's free-text input cannot grant a role, change the security policy, expand the approved task, override tenant-scoped access, or authorize tool effects. Enforcement must occur outside the LLM, before execution or data release.

## Seven evidence families
1. **Exact version and input surface:** frozen SHA, deployment and policy digest; normal user-message channel, session and tenant boundaries; model version/prompt configuration, tool gateway and egress sinks.
2. **Human-approved policy and scope:** authenticated actor and allowed resources, tools, actions, data classes, security invariants, legitimate prompts, forbidden requests, confirmation and review requirements; owner-approved ROE for all active testing.
3. **Source and configuration inspection:** externally enforced instruction/identity separation, typed tool parameters, resource-level authorization, policy enforcement, sensitive data release guards, and traceability; no implication of runtime PASS from code alone.
4. **Positive authorized synthetic flows:** normal permitted prompts produce the expected bounded model outputs and tool interactions under synthetic staging identities.
5. **Negative authorized synthetic flows:** explicit contradictory commands, role or administrator claims, developer-message spoofing, delimiter/format manipulation, encoded and multilingual instructions and multi-turn pressure. Confirm forbidden read/tool intents do not cross downstream policy guards. Do not infer unauthorized outcome solely from generated text.
6. **Correlated runtime proof:** exact SHA, policy and model versions; prompt/response redacted digests, principal/tenant, requested tool and parameters, authorization decision, effects and denied side effects, relevant before/after state and audit correlation. Avoid storing actual secrets in fixtures.
7. **Accountable human review:** tester/owner, written ROE, timestamp, evidence digests, observed impact vs model-only behavior, unsupported attack variants, model variability, limitations, final assessment and exact-version retest.

## Decision semantics
- **Confirmed FAIL** requires reproducible, version-bound evidence that direct user input caused an unauthorized data disclosure, policy bypass, or a forbidden action, with corroborated downstream effect or observable unauthorized disclosure. A successful text-only roleplay does not necessarily prove an external policy bypass.
- **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED** when authorization scope, target/version binding, runtime effects, reproducibility or independent human evaluation is missing. Never convert insufficient evidence into a vulnerability finding or PASS.
- **PASS candidate** only after applicable positive and negative scenarios show policy enforcement outside the model, including before-effect denials, version-bound evidence, and an accountable human decision with explicit limitations.

## Follow-up implementation
Propose **additive migration 054** after KB-030 migration 053, with synchronized canonical signed JSON, CSV, derived SQL and public JSON, SQLite test bootstrap, 107 unchanged control digests, tests and exact-head GitHub CI (including PostgreSQL). Do not rewrite previous migrations, customer findings, or evidence. No agent may authorize itself to run an active assessment. Existing frozen target and security HOLD remain unchanged.

## Informative reference mapping
Existing ARL record maps this control to OWASP LLM Top 10 2025 LLM01 and OWASP Agentic Top 10 2026 ASI01. Crosswalk is informative and does not establish OWASP certification or UKAS accreditation.
