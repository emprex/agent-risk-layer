# AgentRiskLayer local release

The canonical AgentRiskLayer product and local assessment workflow live in this repository.

Local assessment entry point:

```bash
npm run assess:local -- <repository-path> "<request>"
```

The local workflow is owned by `src/agent/arl-local-assessment-runner.mjs` and the canonical AgentRiskLayer authority modules in this repository.

No sibling ARL repository is required for the local assessment workflow. The LLM may assist the operator, but it is not the authority for applicability, evidence validity, severity, finding closure, readiness, controlled-test authorisation or the final deployment decision.
