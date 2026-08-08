# Assessment evidence semantics

AgentRiskLayer separates what a respondent says from what the platform can verify.

- **No proof yet**: the answer is recorded without supporting evidence.
- **My answer only (not verified)**: a customer assertion.
- **Supporting evidence ready (not yet linked or reviewed)**: the customer says evidence exists, but this state receives no additional confidence until an artifact or repeatable test is linked to the assessment.
- **Observed/tested/reviewed evidence**: created only by the relevant evidence workflow; it is never self-selected in the questionnaire.

Unknown answers remain information gaps, not findings. Not-applicable answers remain explicit applicability claims and require evidence when relied on for deployment. The overall declared risk band must not be lower than the highest declared finding or credible attack-path severity; the numerical score remains an aggregate. When unresolved information and known weaknesses coexist, the deployment state is **HOLD FOR INFORMATION AND REMEDIATION**.
