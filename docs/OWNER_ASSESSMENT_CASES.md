# Owner assessment cases

Owner assessment cases are an evidence-only project mode for AgentRiskLayer's platform owner to assess design-partner or customer systems without consuming the owner's normal live-protection project entitlement.

## Security boundary

- Creation requires both the platform `superuser` role and `owner` membership in the target workspace.
- Assessment cases are hidden from ordinary workspace members, including workspace admins, unless they are the platform superuser.
- The case reuses the existing project/workspace tenant boundary and Control Intelligence evidence chain.
- Runtime API keys, runtime approvals and the guided runtime-protection check are denied for assessment cases. A case therefore does not add Guard quota or subscription runtime benefits.
- Normal runtime projects continue to be counted against the billing owner's plan entitlement; assessment cases are excluded from that count.
- Existing projects remain normal runtime projects. There is no conversion path and no destructive migration.

## Evidence workflow

Use an assessment case for immutable system snapshots, control applicability, test records, evidence, findings, remediation, exact retesting and deployment-decision support. Public or customer-provided statements remain declarations until an authorised observation or test establishes stronger evidence.

Rollback should remove application exposure while preserving the additive `owner_assessment_cases` records and all linked assessment evidence. Do not delete case records as a routine rollback because that would destroy evidence lineage.
