# Python Operator — responsive read-only desktop hardening (23 October 2026)

**Status: Draft candidate stacked on integration PR #495. No merge, no deployment, no change to existing local installation.**

## Problem observed in source

The Tkinter application previously executed local Git diagnostics, existing-assessment lookup, evidence work-plan reads and report-bundle verification synchronously from button callbacks. Those calls may include Git operations and bounded Node.js subprocesses of up to 25–45 seconds. During a callback the Tkinter event loop cannot process input or redraw, so the application can appear frozen.

The original screenshot-like illustration was conceptual and does not depict the current Tkinter UI; this PR does **not** claim the UI has been redesigned to match it.

## Small change

- Add `desktop/read_only_jobs.py`: standard-library thread + queue, one read-only job in flight, main-thread result polling through `root.after`.
- Disable selection, refresh and review buttons while a job is in flight, reenable after completion; tabs remain navigable.
- Move all *five* potentially blocking GUI reads off the Tk thread: product diagnostics, selected Git target inspection, previously registered assessment lookup, existing evidence request plan, saved report verification.
- Fail closed on worker exceptions; neither private error strings nor customer data are surfaced in widgets or logs.
- Suppress late callbacks if the window has closed; background threads are daemonised. This does **not** cancel the underlying Node subprocess; it runs until its existing timeout, so no active tests may be added through this mechanism.
- When selecting a different repository, clear previous assessment, evidence table and report result, rather than leaving old data visible.
- A verified saved report with a different target SHA from the chosen repository is **not** displayed as corresponding to that selection.
- A standalone report with no selected local repository explicitly says it has no assessment binding, even if its own file contents are internally consistent.

## Trust boundaries

The existing Node.js assessment engine and PostgreSQL retain all authority. Neither the thread helper nor the Python GUI performs SQL writes, accepts evidence, computes severity, executes active tests, decides readiness or approves deployment. All snapshot/assessment/SHA validations stay in the existing read-only bridges. Report checks establish **content consistency only**, not signatures or assessment authenticity.

## Tests and acceptance

Headless Python regression cases verify that:
- a slow task executes on a worker thread and the completion callback runs on the UI thread;
- a second request is refused while a first is running;
- sensitive exception messages never become user-visible results;
- closing the window drops late completion callbacks;
- non-dictionary output fails closed;
- report Git association is not claimed for mismatched revisions.

The existing `npm test` workflow calls all `desktop/test_*.py` cases, and the existing Node/CI matrix checks ARL's other functionality.

**The actual Debian 13 graphical desktop is not tested in GitHub CI.** When the owner is at the laptop, use a separate checkout and disposable synthetic target/database per `docs/OPERATOR_COMBINED_INTEGRATION_ACCEPTANCE_2026-10-22.md`. Specifically check the window stays responsive while a synthetic inspection is in progress, buttons cannot start two jobs, and closing the window does not print sensitive exceptions.

No approval to merge into `main`, distribute a package, run third-party tests or alter production services is inferred from CI success.
