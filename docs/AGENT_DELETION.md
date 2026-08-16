# Agent deletion

Agent deletion is a destructive owner action for removing one AI-agent scope without deleting the whole AgentRiskLayer account.

## Scope

For an agent linked to a Runtime/evidence project, deletion removes the linked `security_projects` record and project-scoped dependent records through the database's existing foreign-key cascade path. This includes project API keys, runtime decisions, inventory, remediation and Control Intelligence records. The same transaction removes the signed-in user's assessment history grouped by the dashboard's existing agent identity rule: normalized agent name plus agent type.

Payment and billing records are not deleted by this action. Their assessment/project references are detached by the existing `ON DELETE SET NULL` relationships so accounting history is preserved. Account deletion remains a separate workflow.

For an assessment-only agent with no linked project, the dashboard removes the assessments in that agent history using the existing authenticated assessment-deletion endpoint.

## Approval and authorization

A linked-project deletion requires:

- an authenticated, email-verified request through the existing project PATCH endpoint and CSRF protection;
- `owner` role for the exact linked project;
- an owned anchor assessment;
- an exact project-name/assessment-name scope match;
- the operator to type the exact agent name as the confirmation value;
- no other active workspace members.

Shared-workspace deletion is rejected rather than allowing one member to erase evidence used by another tenant member.

## Evidence and retention boundaries

The deletion event retained in the account event stream contains bounded identifiers and counts only. It does not retain the deleted agent name, prompts, raw tool arguments or evidence payloads.

If an assessment is referenced by retained Risk Knowledge validation evidence, deletion is blocked. That retained validation source must first be deliberately removed or superseded so AgentRiskLayer does not preserve a validation claim after deleting its source evidence.

## Failure behavior

Linked project and assessment-history deletion execute in one database transaction. A scope mismatch, confirmation mismatch, shared-workspace condition, retained validation reference, authorization failure or database constraint failure rolls back the operation. No partial linked-project deletion is accepted.

## Verification requirements

Regression coverage must verify exact confirmation, owner authorization, shared-workspace protection, project/key/runtime/inventory cascade deletion, preservation of an unrelated agent and invalidation of a deleted project's API key.
