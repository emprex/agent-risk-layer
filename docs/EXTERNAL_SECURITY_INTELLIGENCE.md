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
Pinned source revision: `69dcbd323c155312fb000ec89ea0b1efdf6a5757`

The importer requires the exact upstream `LICENSE` file, retains that exact licence notice with the imported corpus record, and stores its SHA-256 for integrity checking. It does not invent, paraphrase or replace the upstream licence text.

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
10. fails closed on malformed records or an unexpected frozen-snapshot row count.

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
  --revision 69dcbd323c155312fb000ec89ea0b1efdf6a5757 \
  --dry-run
```

After the dry run reports the expected frozen row count, rerun with the configured PostgreSQL environment and without `--dry-run`.

The import is marked `complete` only after aggregate signals are rebuilt and the total row count is recorded. Failed imports remain marked `failed`.

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
