# Control Intelligence guidance-loop hotfix — 17 August 2026

Production normal-user verification after `2da4e94790c649bae29996050a1094ffee7058be` reproduced a browser `Page Unresponsive` condition on the focused Control Intelligence Test page.

Root cause: the newly added customer-guidance `MutationObserver` called `enhanceTest()`, which unconditionally rewrote `<option>` and submit-button `textContent`. Those writes themselves produced child-list mutations observed by the same observer, creating a self-sustaining render loop.

Hotfix requirements:
- make text decoration idempotent: write only when the displayed text actually differs;
- coalesce observer callbacks into one microtask and block re-entry while enhancement is running;
- preserve all existing evidence, applicability, finding, runtime and deployment-decision semantics;
- no backend, persistence, assessment, tenant, authentication or billing changes.

Production acceptance: hard-refresh the same Northstar ARL-KB-001 Test URL. The page must become responsive and render the saved test plan/guidance without altering the saved evidence state.