# AgentRisk Inspector 4.0.0 — ClawHub test-split baseline

Date: 2026-08-09
Repository baseline: `787bd50b02386b0fe5de77468712c4d539b75063`
Inspector: `4.0.0`
Policy: `arl-inspector-policy-2026.09`

## Corpus evidence

- corpus: `OpenClaw/clawhub-security-signals`
- source revision: `b78f0484811af3de35977b828b91d57f5c6491a2`
- split: `test`
- source SHA-256: `89ab5a8383e2d0795cf3ea1fb715523e7f87463f3bf00f4354f421833a658209`
- rows requested: 6747
- rows evaluated: 6747
- scan errors: 0
- benchmark-result SHA-256: `f1c5d8473723238b5f6143da7e2c2a94b89777c9d7f059b3234b9e980aae7aa9`

## Observed AgentRisk Inspector result

- benchmark-relevant ARL-positive rows: 83
- bundle files materialised: 6433
- bundle files skipped: 0
- corpus code executed: no
- network probing: no
- VirusTotal fields used: no

## External-signal concordance

### clawscan

- both positive: 49
- AgentRisk Inspector only: 34
- external signal only: 2580
- both non-positive: 4084
- ARL detection rate on external-positive rows: 0.018638

### static

- both positive: 21
- AgentRisk Inspector only: 62
- external signal only: 426
- both non-positive: 6238
- ARL detection rate on external-positive rows: 0.046980

### skillspector

- both positive: 75
- AgentRisk Inspector only: 8
- external signal only: 3259
- both non-positive: 3405
- ARL detection rate on external-positive rows: 0.022496

These values measure concordance with external silver-standard scanner signals. They are not accuracy, false-negative, certification or superiority measurements.

## Explicit predeclared coverage gaps

- `skillspector:MCP Tool Poisoning`: 505 source rows
- `skillspector:Data Exfiltration`: 205 source rows
- `skillspector:Rogue Agent`: 147 source rows
- `skillspector:Data Flow`: 110 source rows
- `static:suspicious.prompt_injection_instructions`: 55 source rows
- `static:suspicious.potential_exfiltration`: 20 source rows

## Root-cause inspection

Repository inspection after the baseline run found that `runSourceChecks()` only performs AI/execution/security analysis on files accepted by `isSourceCandidate()`.

`isSourceCandidate()` currently accepts executable/source-code extensions but not Markdown. Therefore `SKILL.md` instruction surfaces are not subject to the main AgentRisk AI/tool/execution security checks. Secret scanning may still inspect Markdown independently.

The corpus diagnostic also showed that the majority of rows in the investigated external-signal categories have no bundled executable files, making instruction-surface coverage materially relevant.

## Decision

**Do not run `eval_holdout` yet.**

Preserve this result as the Inspector 4.0.0 pre-improvement baseline. Develop and validate instruction-surface inspection using development/validation evidence first, rerun the frozen `test` split after changes, then freeze the Inspector and execute `eval_holdout` once.

## Claim boundary

This proprietary benchmark is not an accredited certification and does not establish that AgentRiskLayer, ClawScan or SkillSpector is more accurate than another scanner.
