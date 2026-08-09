# AgentRiskLayer ClawHub Inspector 4.1 Evidence

Generated: 2026-08-09T22:02:44.976479+00:00

## Assessed implementation

- AgentRisk Inspector: `4.1.0`
- Policy: `arl-inspector-policy-2026.10`
- Frozen source commit: `9cea5cf4c1b700f8cfaae53bb99a1020d57860d2`
- Downloadable Inspector SHA-256: `2973cc9a435b59d7fc08aed78c915da12c5ea42dea58550f3e88e29f94a71b9a`
- Corpus revision: `b78f0484811af3de35977b828b91d57f5c6491a2`

## Local regression evidence

Before freezing this source revision, the complete local application regression
suite passed **246/246 tests with 0 failures**.

## Development validation split

- Rows evaluated: 10076
- Scan errors: 0
- ARL-positive rows: 502
- ARL-positive rate: 4.982%
- Result SHA-256: `4876f32286a00135ab4362bce58619c20a56d94791a194fd0983c9286f2331cc`

The validation split was used for development, diagnosis and precision tuning.
It is not represented as an independent blind evaluation.

## Frozen test comparison

### Inspector 4.0 baseline

- Rows evaluated: 6747
- Scan errors: 0
- ARL-positive rows: 83
- ARL-positive rate: 1.230%
- Baseline JSON SHA-256: `f1c5d8473723238b5f6143da7e2c2a94b89777c9d7f059b3234b9e980aae7aa9`

### Inspector 4.1

- Rows evaluated: 6747
- Scan errors: 0
- ARL-positive rows: 295
- ARL-positive rate: 4.372%
- Result JSON SHA-256: `fd5d5ddd266850de61967ede12e9e0e62a7839a86523262b65091aac7c8c4850`

The test split was previously inspected at aggregate/category level during
architectural diagnosis. It is therefore suitable for reproducible version
comparison, but it is **not claimed to be a pristine blind final evaluation**.

## New instruction-surface findings on the test split

- `ARL-INS-001`: 76 rows
- `ARL-INS-002`: 66 rows
- `ARL-INS-003`: 1 rows
- `ARL-INS-004`: 14 rows
- `ARL-INS-005`: 69 rows

## External-signal concordance

These figures measure concordance against external silver-standard signals.
They are **not accuracy, false-positive rate, false-negative rate, confirmed
vulnerability prevalence, certification or superiority measurements**.

| Source | 4.0 external-positive | 4.1 external-positive | 4.0 external-non-positive | 4.1 external-non-positive |
|---|---:|---:|---:|---:|
| clawscan | 1.864% | 6.618% | 0.826% | 2.938% |
| static | 4.698% | 11.633% | 0.984% | 3.857% |
| skillspector | 2.250% | 6.539% | 0.234% | 2.256% |

## Explicit remaining benchmark coverage gaps

- `skillspector:Data Flow` — 110 externally signalled rows
- `skillspector:MCP Tool Poisoning` — 505 externally signalled rows

## Safety and evidence boundary

- Corpus code executed: `False`
- Network probing: `False`
- VirusTotal fields used: `False`
- External corpus signals do not automatically become customer findings.
- This benchmark does not establish certification or comparative superiority.

## Final-evaluation boundary

`eval_holdout` remains untouched by development and tuning.

It is reserved for one final evaluation of the frozen Inspector. Rules,
mappings or thresholds must not be modified in response to that result without
explicitly invalidating its status as the untouched final evaluation.

## Claim boundary

This report measures concordance between AgentRisk Inspector findings and external silver-standard signals on sanitized reconstructed skill artifacts. It is not an accuracy, prevalence, certification or superiority claim.
