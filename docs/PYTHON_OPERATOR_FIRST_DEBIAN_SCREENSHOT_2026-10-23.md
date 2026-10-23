# ARL Python Operator — first real Debian screenshot acceptance

**Date:** 23 October 2026. **Status:** first boot accepted; visual layout needs improvement. This is *not* operational, database, security or deployment acceptance.

## Screenshot-derived observations

The owner launched the pinned candidate `4670f3e29bffa7ae1565c37ef6d7b79737545e67` in a separate Git worktree at `~/arl-operator-acceptance`, after installing Debian's `python3-tk`.

The 23 October screenshot shows:
- A real Tkinter application window, title `AgentRiskLayer — Local Operator`.
- All five tabs exist: Overview, Assessments, Evidence, Controlled tests, Reports.
- Manifest version `10.1.1`, Git revision `4670f3e29bffa7ae1565c37ef6d7b79737545e67`, and a clean **test checkout** worktree.
- Explicit `DATABASE: NOT CHECKED`, `ASSESSMENT: NOT LOADED` and `READINESS: NOT EVALUATED`.
- The content is cramped into a narrow column in the top-left; the maximized desktop has excessive unused white space. Information hierarchy and controls are not yet at product quality.
- No evidence was shown of actual authorised assessment inspection, PostgreSQL connection, report verification, responsive task behaviour, or functional tab tests.

The conceptual generated image is *not* a real ARL UI screenshot and must not be represented as implemented.

## Narrow presentation correction in this PR

- Larger default/minimum desktop window.
- Six clearly labelled, responsive 3×2 status cards for version, local Git SHA, **GUI checkout** status, PostgreSQL, assessment selection and security evaluation.
- Two information panels explain the real existing-only Assessments and read-only Evidence/Reports workflows.
- Improve native tab and action button spacing and typography.
- No mocked customer data, assessment counts, trust percentages, live metrics, fabricated readiness or fake navigation.
- Preserve all pre-existing read-only logic, CLI, tests, subprocess boundaries, authority gates and database schemas.
- Unit tests assert that dirty/unavailable working trees aren't shown clean, PostgreSQL is not shown connected, and no security readiness is inferred.

## Manual Debian acceptance before merge

Only after exact-head GitHub CI passes, stop the test window, verify the separate `~/arl-operator-acceptance` worktree is clean and still at the previously pinned SHA, fetch the new branch's pinned exact head, and switch **only that detached test worktree**. Do not update `~/agent-risk-layer` or connect customer/production systems.

Then verify: Overview cards distribute across the width of the maximised screen; no clipping at minimum window size; focus/navigation, button hover, tab content, scaling and closing work. Compare to the first screenshot. Run headless regressions and inspect a disposable synthetic target only when independently authorised.

**Merge and deployment remain HOLD** pending security review, full UI acceptance and human release decision.
