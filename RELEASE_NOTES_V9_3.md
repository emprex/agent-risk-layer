# AgentRiskLayer v9.3.0 — Guided customer protection journey

Release date: 30 July 2026

## Customer journey repair

- Replaces the technical control-plane landing view with one clear customer question: **What should your agent be allowed to do?**
- Presents a single recommended next action instead of requiring customers to discover projects, policies, keys, approvals and terminal commands in the correct order.
- Adds a one-click, authenticated **safe protection check** using fictional refund data.
- Runs four real policy and approval decisions in the browser: missing approval denial, changed-value denial, exact-action allow-and-consume and replay denial.
- Does not reveal an API key or approval bearer token, does not require a terminal and does not call an external refund or customer system.
- States transparently that each run consumes four monthly protection checks.
- Keeps the customer’s published project policy unchanged and records synthetic events separately as `guided_demo` evidence.
- Excludes guided demonstration events from deployment-readiness evidence so a synthetic check cannot be mistaken for customer integration proof.

## Progressive disclosure

- Moves API keys, policy internals, inventory, exact-action approvals, remediation and audit evidence behind an explicit **Technical controls** view.
- Remembers Technical controls only for the current browser session, so a later customer session returns to the guided starting point.
- Keeps all existing specialist functionality available without making it the default customer experience.
- Renames specialist sections in plain language: Connect, Rules, Access map, Fix and retest, and Audit.
- Reworks the project rail as **Your protected agents** and describes environments in customer language.
- When the Community plan already has one active project, directs the customer to use that project instead of presenting another-project creation as the next task.
- Adds responsive guided cards and result states for desktop and mobile layouts.
- Corrects the public demonstration’s visible progress count from five to eight steps.

## Security and privacy boundaries

- Restricts the guided protection check to project administrators and owners.
- Uses the same hosted Guard and exact-action approval engine as the production API path.
- Creates the approval server-side, stores only its digest and never returns the token to the browser.
- Records the authenticated user and synthetic evidence in the existing audit and retention systems.
- Suppresses external denial notifications for synthetic checks and never executes an external tool.
- Preserves fail-closed behaviour and tenant isolation.

## Internal validation

- Complete isolated release gate: **159/159 tests passed**, zero failures and zero skipped tests.
- Focused guided-journey and approval gate: **33/33 tests passed**.
- End-to-end smoke exercised the authenticated guided route and preserved the existing exact-action approval, export and account-deletion journeys.
- Internal synthetic detection regression: **20/20 passed** on the stated limited dataset.
- Deterministic safety regression: **1,000/1,000 scenarios passed** with zero unsafe deployment decisions.
- Automated browser rendering was unavailable in the build environment because local browser navigation was blocked by administrator policy; authenticated HTTP smoke, static customer-journey tests and responsive source checks are the available internal evidence.

## Verification boundary

- The guided check proves the AgentRiskLayer-hosted decision and approval path with synthetic data. It does not prove that a customer has integrated their own agent or blocked direct access to its tools.
- Automated results are internal engineering evidence, not independent usability research, penetration testing, accredited certification or a guarantee that the system is risk-free.
- Production deployment and a live authenticated browser journey must be verified against the exact deployed commit before release effectiveness is claimed.
