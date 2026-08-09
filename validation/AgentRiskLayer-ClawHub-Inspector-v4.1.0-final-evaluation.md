# AgentRiskLayer ClawHub Inspector 4.1 Final Evaluation

- Inspector: 4.1.0
- Policy: arl-inspector-policy-2026.10
- Frozen Inspector source commit: 9cea5cf4c1b700f8cfaae53bb99a1020d57860d2
- Pre-evaluation evidence commit: c7e41a8df7c3401d21c848dd2516369417b73f2c
- Corpus revision: b78f0484811af3de35977b828b91d57f5c6491a2
- Split: eval_holdout
- Source rows: 3368
- Source SHA-256: 0c3d2f7d47ba03a235e0c6871acf60e9cad93ef082d78bacef19d065c2de8dad
- Rows evaluated: 3368
- Scan errors: 0
- ARL-positive rows: 162
- ARL-positive rate: 4.810%
- Result SHA-256: 86da9d96687962e2b525fb22d3281d8e8a65a4027eb041dd13bf09c319f33516

The eval_holdout split was not used for rule development or threshold tuning before this final run.

This evaluation measures concordance against external silver-standard security signals on sanitized reconstructed artifacts. It is not an accuracy, prevalence, certification or superiority claim.

No Inspector 4.1 rules or thresholds will be changed in response to this holdout result without invalidating its status as the final untouched evaluation.
