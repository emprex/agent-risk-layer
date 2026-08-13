# Control Intelligence Red Team evidence binding

## Purpose

Control Intelligence can bind an uploaded AgentRiskLayer Red Team baseline/retest pair to one exact passed Control Intelligence retest. The goal is to preserve a defensible evidence chain without turning customer-operated testing into an unsupported claim of independent attestation.

The binding is deliberately narrow:

`reproduced Control Intelligence failure → finding → implementation evidence → changed system snapshot → exact Control Intelligence retest → signed Red Team failed baseline + passed retest with the same request fingerprint → closure review`

## Required server checks

A qualifying binding requires all of the following:

- the actor is a project `admin` or `owner`;
- the Control Intelligence test is a passed `retest` on the current snapshot and is bound to the original failed execution, finding and remediation;
- active implementation evidence exists for that remediation;
- baseline and retest Red Team runs are owned by the project's billing identity and belong to the same assessment;
- both uploaded runs have valid signatures and the `customer-operated-controlled-adversarial-test` evidence class;
- both runs are authorised adapter-backed local/test/staging target runs, not simulations;
- both runs use the same Rules of Engagement authorisation, target origin/path hash/profile and Red Team policy version;
- the baseline case failed, the retest case passed, and both carry the same valid request fingerprint and case title;
- the evidence is still inside the retained source window;
- the project admin/owner explicitly confirms the assessment/snapshot association and the customer-operated trust boundary.

If the finding did not previously have an `assessment_id`, the successful binding establishes that relationship to the validated Red Team assessment. A conflicting existing assessment relationship fails closed.

## Trust semantics

The stored Control Intelligence evidence remains `verification_state=verified` only because the server verified the uploaded bundle signature/digest, exact failed→passed case comparison and binding invariants. The descriptor additionally records:

`verificationScope = integrity_verified_customer_operated`

This scope is mandatory for Red Team evidence to qualify. It means:

> Integrity-verified redacted outcomes from a customer-operated local/test/staging run. AgentRiskLayer did not independently operate the target or retain raw transcripts.

The system snapshot association is an authorised human confirmation, not an independent machine attestation that the adapter target equals production. This limitation is stored in the evidence descriptor and audit trail.

A Red Team source may legitimately have completed before a retrospective Control Intelligence test record was entered. The ordinary temporal rule that rejects evidence timestamped before a linked test record therefore does not apply to a validated Red Team binding; the signed campaign completion time remains the source observation time.

## Closure and deployment boundary

A signed Red Team binding can qualify as evidence for the exact retest and finding closure, alongside a snapshot-bound runtime observation. It does not prove unrelated controls, other attack paths, production equivalence or overall system security.

Closure still requires human review of remaining limitations and residual risk. Deployment decisions remain server-derived and continue to account for every applicable control, open finding, missing evidence, required approval and stale snapshot.

AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile ARL-RKA-1.2.0.

This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.
