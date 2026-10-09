# Synthetic operator dashboard acceptance demo

This demo exercises the **actual offline operator HTML renderer** on **synthetic, invented records**. It is not connected to a customer's AgentRiskLayer assessment or to a local frozen target.

## Generate locally (no database or agent required)

```bash
npm run demo:operator
```

The command prints the exact path of a content-addressed HTML file in `data/operator-demo`. Open the HTML file in a browser. It does not execute JavaScript or make network requests.

## Get a preview without a laptop

For each pull-request or main CI execution, open its GitHub Actions **CI** run and download the artifact **`arl-operator-dashboard-synthetic-demo`**. It contains exactly one standalone HTML file. CI retains this *synthetic-only* artifact for seven days. The local owner-controlled export is intentionally **not** uploaded.

The demo has a prominent **SYNTHETIC DEMONSTRATION — NO REAL ASSESSMENT OR CUSTOMER DATA** notice. The snapshot is `SYNTHETIC_DEMO_NOT_AN_ASSESSMENT`; the target revision is forty zeroes and is **not** a real Git commit.

## Scope of demonstration

- 108 invented control records across three pages.
- 98 independently actionable review controls in five bounded batches.
- KB-006 simulated as a blocker and deliberately excluded from independent review.
- Nine simulated human-decision/completed controls excluded.
- Mixture of synthetic unverified static metadata candidates, absent evidence and retired records.
- Original criteria and their operator follow-up actions, with PASS/FAIL *undetermined*.
- No actual tests, targets, PostgreSQL, credentials, customer documents, or external API calls.

## Safety and release boundary

This preview is for an operator UX and data-flow acceptance review only. **Green CI and a successful synthetic preview do not validate the actual customer's evidence**, do not close KB-006, and do not approve deployment.

The production command remains `Export assessment operator dashboard`, called through the existing owner-controlled local assessment runner and exact SHA/assessment binding. It must be validated on the frozen assessment after the operator regains access to the laptop; don't upload that local export to public GitHub artifacts.

The demonstration CI workflow invokes only the dedicated synthetic script, never the authenticated production export command.
