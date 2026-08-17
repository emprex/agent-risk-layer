# AgentRiskLayer customer-journey 8.5 release gate

Date: 18 August 2026

Primary loop: Come -> Understand -> Assess -> Pay -> Fix -> Prove -> Deploy -> Improve -> Return -> Refer.

This is an execution gate, not a marketing scorecard. A stage only passes when the current product gives a normal customer a clear location, current learning, why it matters, one next action and what happens after that action. Evidence semantics must remain intact: unknown information is not a finding; declarations are not proof; remediation is not verified until bounded retest evidence supports closure; AgentRiskLayer supplies evidence and an accountable human records the deployment decision.

## Release threshold

Target: every active customer stage >= 8.5/10 in repository review, with production verification required after deployment. Refer is considered correctly implemented when referral is deferred until real value is delivered; no referral mechanism should interrupt assessment, payment, remediation or deployment work.

## Stage gates

| Stage | Minimum 8.5 behaviour | Current repository evidence / action |
| --- | --- | --- |
| Come | Qualified buyer understands this is for tool-connected agents with real authority/evidence needs and sees one primary assessment action. | Homepage/customer-journey regression tests. |
| Understand | First screen explains what can happen, what AgentRiskLayer checks, evidence received and next step without leading with the control catalogue. | Homepage and pricing hierarchy. |
| Assess | One-agent guided flow; unknown stays information gap; one clear result action. | Assessment/result semantics and regression tests. |
| Pay | Result -> checkout -> payment -> same assessment context. No public simulated purchase path. Paid outcome is explicit. | `pricing-mode.js`, `success.js`, commercial continuity tests. |
| Fix | Confirmed findings and material evidence gaps first. Each issue exposes consequence, evidence state, fix, owner and exact proof/retest. No normal-customer requirement to work all 108 controls. | `result.js`, assessment remediation workspace, stale demo-agent copy removed. |
| Prove | Declared -> observed -> finding -> test/runtime/approval -> remediation -> retest remains visible and non-inflated. | Trust Centre, result, Control Intelligence. |
| Deploy | Server-recorded evidence posture is shown first. Accountable human decision remains distinct from runtime completion. | Deployment evidence page / Control Intelligence. |
| Improve | Material changes make previous evidence stale only where relevant and preserve history. | Versioned snapshots, assessment history, evidence chain. |
| Return | Dashboard reopens the selected agent and gives one recommended action before specialist tools. | Dashboard selected-assessment continuity and post-checkout handoff. |
| Refer | Do not ask for referral before payment/remediation/retest/decision value. Sharing/referral should only be surfaced after a defensible outcome. | Deliberately gated; no pre-value referral interruption. |

## Fixes applied in this pass

1. Public demo checkout now fails closed. Non-production demo pages may describe that live payments are unavailable, but the public pricing UI does not simulate a real-looking purchase.
2. Paid one-off assessment checkout now returns to the same assessment context instead of a generic dashboard. The success state tells the customer to continue with that agent, assign the first fix, attach implementation evidence and retest the exact risk.
3. Trust Centre billing wording no longer makes a static operational claim that can contradict runtime configuration. It describes production requirements and sends current-state verification to System status.
4. Remediation scope guidance no longer leaks the synthetic `Northstar` example into a real customer project selector.
5. New commercial-continuity regression tests protect result -> checkout -> same assessment, no simulated public checkout, explicit paid outcome and one-action dashboard hierarchy.

## Production verification before declaring the gate complete

After the deployment serving the commits from this pass is live:

1. Open Pricing in a logged-out production browser. Confirm no demo/simulated checkout copy appears and live checkout buttons are usable only when production billing readiness is valid.
2. Complete one real or authorised low-value Stripe test/live purchase using a disposable assessment. Confirm Stripe returns to `success.html`, fulfilment completes and the primary button opens `/dashboard.html?assessment=<same assessment>`.
3. Confirm that dashboard selects the same agent and the first recommended action matches its actual state rather than a generic workspace action.
4. For a paid assessment with a confirmed finding, follow Start remediation. Confirm a dedicated remediation scope can be created, the finding explains impact/fix/owner/proof and no synthetic agent name appears.
5. Attach implementation evidence and run an authorised bounded retest. Confirm the finding is not verified/closed before the retest evidence supports closure.
6. Open Deployment evidence. Confirm the server-recorded posture, blockers and evidence are visible before the full control catalogue and that the human decision remains accountable and explicit.
7. Recheck mobile navigation and the paid path on Android-sized viewport.

Any failed production step reopens that journey stage below 8.5. Do not compensate by adding unrelated features.
