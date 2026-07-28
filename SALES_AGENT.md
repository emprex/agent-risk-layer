# AgentRiskLayer Sales Agent

The Sales Agent is an owner-only revenue workspace at `/sales-agent.html`. It is protected by the same verified-superuser and production MFA requirements as owner operations.

## What it does

- Stores evidence-backed prospects and named buyers.
- Scores fit transparently from recorded facts.
- Tracks pipeline stages, next actions, demonstrations, sales and revenue.
- Generates personalised connection, first-message, assessment-offer and follow-up drafts.
- Keeps every generated message in draft until the owner explicitly approves it.
- Prevents a draft from being marked sent before approval.
- Produces a prospect-specific 15-minute demonstration brief.
- Records an operational audit event for each prospect, message and activity change.

## Qualification model

The maximum score is 100. Points are awarded only for recorded information:

- Specific AI-agent use case: 20
- Real tool, data or system access: 20
- Current buying trigger: 15
- Named decision-maker: 15
- Contact route: 10
- Public evidence: 10
- Target company size (1–200): 10

A record with neither an agent use case nor tool access receives a 25-point deduction. The score reasons remain visible beside each prospect.

## Safe operating boundary

The module does not scrape LinkedIn, send email, or publish messages automatically. It never invents customer results. It does not claim certification, guaranteed security, zero risk or automatic compliance. The founder reviews and approves each external message before manually sending it through the chosen channel.

## First operating cycle

1. Add a company and its public evidence.
2. Confirm the buyer and agent-security need.
3. Review the score and reasons.
4. Generate a connection or first-message draft.
5. Edit the draft if needed and approve it.
6. Send it manually, then mark it sent.
7. Record the reply and next action.
8. Use the demo brief when a meeting is booked.
9. Record the £99 assessment or subscription sale and move the pipeline stage.

## Production migration

Migration `004_sales_agent.sql` creates three isolated tables:

- `sales_prospects`
- `sales_messages`
- `sales_activities`

The normal application startup migration runner applies it transactionally under the existing PostgreSQL advisory lock.
