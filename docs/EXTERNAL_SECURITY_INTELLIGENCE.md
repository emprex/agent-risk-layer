# External Security Intelligence

## Purpose

AgentRiskLayer may use external research corpora to improve control prioritisation, benchmark deterministic inspection and give customers contextual examples. External intelligence is never authoritative evidence about a customer system.

The first supported corpus is the frozen paper snapshot of `OpenClaw/clawhub-security-signals`.

## Evidence boundary

External corpus signals are classified as `external_reference` only.

They MUST NOT:

- move a project control from declared to observed or test-passed;
- create a customer finding by themselves;
- change customer finding severity;
- satisfy a deployment gate;
- be represented as human-verified ground truth;
- imply endorsement by OpenClaw, NVIDIA, VirusTotal or another upstream provider.

Customer evidence remains project-bound evidence collected through AgentRiskLayer assessment, inspection, red-team, runtime, approval, remediation and retest workflows.

## Legal and licence boundary

Upstream dataset: `OpenClaw/clawhub-security-signals`  
Licence: MIT  
Pinned source revision: `b78f0484811af3de35977b828b91d57f5c6491a2`

The importer requires the exact upstream `LICENSE` file, retains that exact licence notice with the imported corpus record, and stores its SHA-256 for integrity checking. It does not invent, paraphrase or replace the upstream licence text.

The importer also pins the four frozen JSONL source files by basename, deterministic split, row count and SHA-256. A missing, duplicate, substituted, truncated or changed source file fails closed before the corpus can become active.

AgentRiskLayer does not call the VirusTotal Public API for this feature. VirusTotal-derived per-record fields are discarded before persistence and are never exposed to customers. If commercial VirusTotal integration is desired later, it requires a separately reviewed commercial agreement and explicit owner approval.

NVIDIA SkillSpector-derived category names are used only as source-attributed reference signals from the MIT-licensed dataset. They are not represented as NVIDIA findings about an AgentRiskLayer customer.

## Security boundary

All corpus rows are untrusted data. The importer:

1. reads owner-supplied local JSONL files only;
2. does not fetch remote URLs;
3. never executes scripts or package installers;
4. never renders corpus HTML;
5. never sends corpus text to a model;
6. strips `skill_md_content`, `skill_bundle_content`, `clawscan_summary` and `clawscan_context`;
7. strips every top-level `virustotal_*` field;
8. stores only a SHA-256 of `skill_slug`, not the public slug itself;
9. validates the source record digest, split and ClawScan verdict;
10. validates every frozen source filename, row count and SHA-256 and rechecks them before the import is marked complete.

Raw corpus files belong outside Git, outside `public/`, and outside application backups unless a separate retention decision explicitly includes them.

## Evaluation split policy

The upstream deterministic split is preserved.

- `train`: may be used for development.
- `validation`: may be used for validation and tuning.
- `test`: may be used for internal final checks before a frozen evaluation.
- `eval_holdout`: final evaluation only. It must not be used for rule development, prompt/rule tuning, threshold selection or training.

The application enforces this boundary in `assertBenchmarkPurposeAllowed`.

## Import procedure

Do not import from application startup and do not add Hugging Face as a runtime dependency.

Download the exact frozen files and upstream `LICENSE` through an owner-approved workstation process, verify the selected revision, then run a dry validation first:

```bash
node scripts/import-clawhub-security-signals.mjs \
  --file /private/clawhub/train.jsonl \
  --file /private/clawhub/validation.jsonl \
  --file /private/clawhub/test.jsonl \
  --file /private/clawhub/eval_holdout.jsonl \
  --license-file /private/clawhub/LICENSE \
  --revision b78f0484811af3de35977b828b91d57f5c6491a2 \
  --dry-run
```

After the dry run reports the pinned files and expected split counts, rerun with the configured PostgreSQL environment and without `--dry-run`.

The import is marked `complete` only after the exact source files are rechecked, aggregate signals are rebuilt and the total row count is recorded. Failed imports remain marked `failed` and do not become active reference data.

## Inspector benchmark procedure

The benchmark is intentionally separate from customer evidence and from the production import. It reconstructs each sanitized skill row in a short-lived local directory and runs the existing read-only AgentRisk Inspector against that material.

Safety and validity controls:

- the selected JSONL split must match the exact pinned SHA-256 and row count;
- the benchmark preserves the upstream split label;
- `eval_holdout` requires an evaluation purpose and is blocked from tuning/rule-development use;
- corpus files are treated as inert text and are never executed;
- path traversal, oversized files and excessive bundle sizes are rejected/skipped;
- temporary reconstructed artifacts are deleted after each scan;
- no network probing is performed;
- VirusTotal-derived fields are not used;
- generic repository-hygiene rules are excluded from comparison to avoid meaningless findings caused by the temporary benchmark directory itself;
- the existing Inspector rules are not modified from the holdout results before that holdout run is frozen and recorded.

Run the frozen holdout only when the exact source file is available locally:

```bash
npm run test:clawhub-inspector -- \
  --file /private/clawhub/eval_holdout.jsonl \
  --split eval_holdout \
  --purpose evaluation \
  --out validation/clawhub-inspector-eval-holdout.json
```

The output records source revision/digest, split, Inspector version/policy version, evaluated rows, scan errors and aggregate concordance/disagreement metrics. It does not copy raw skill content into the report.

### Benchmark interpretation

The benchmark answers bounded questions such as:

- when an external scanner marks a row positive, how often does the current Inspector emit one of its relevant findings?
- where does Inspector emit a relevant finding while a selected external scanner is non-positive?
- for pre-mapped signal categories, how often does a semantically related ARL rule appear?

It does **not** establish accuracy because the external scanner labels are not human-verified ground truth. It does **not** establish that an AgentRiskLayer result is correct merely because another scanner agrees, and disagreement does not by itself establish that either scanner is wrong.

Until a complete pinned run has been executed and archived, there is no quantitative AgentRiskLayer/ClawHub benchmark claim.

## Website behaviour

The Risk Library reads a small bundled customer-safe aggregate manifest. It contains no raw skill content and no VirusTotal per-record fields. If this manifest is unavailable or malformed, the external-intelligence panel is simply omitted; the Risk Library continues to work normally.

The panel is deliberately secondary to the AgentRiskLayer control. It states that the corpus is reference context and cannot prove a customer vulnerability or satisfy an AgentRiskLayer control.

## Rollback

The feature is additive.

Application rollback:

1. remove the external-intelligence panel/static manifest from the web build;
2. keep or delete the external tables independently;
3. no assessment, risk-knowledge, Control Intelligence, billing, authentication or runtime record requires these tables.

Data rollback:

```sql
DELETE FROM external_intelligence_corpora
WHERE id = 'openclaw-clawhub-security-signals-paper-v1';
```

Foreign-key cascades remove the imported metadata and aggregates without touching any AgentRiskLayer project evidence.

## Claims

Allowed wording:

> AgentRiskLayer uses the MIT-licensed OpenClaw ClawHub Security Signals research corpus as external reference intelligence and as a reproducible benchmark source. External corpus signals do not establish vulnerabilities in customer systems.

Not allowed without additional evidence/permission:

- “VirusTotal verified by AgentRiskLayer.”
- “NVIDIA approved AgentRiskLayer.”
- “ClawHub certifies this agent.”
- “AgentRiskLayer is more accurate than VirusTotal/SkillSpector.”
- any benchmark superiority claim before a pinned, reproducible evaluation has actually been run and documented.
