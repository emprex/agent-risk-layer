# Third-Party Data Register

This register records external datasets used by AgentRiskLayer. It is an operational provenance record, not legal advice or a certification.

## OpenClaw ClawHub Security Signals — frozen paper snapshot

| Field | Recorded value |
|---|---|
| Dataset | `OpenClaw/clawhub-security-signals` |
| Publisher | OpenClaw |
| Purpose | External security reference intelligence and reproducible Inspector/rule evaluation corpus |
| Licence | MIT (upstream dataset declaration) |
| Pinned revision | `b78f0484811af3de35977b828b91d57f5c6491a2` |
| Source | `https://huggingface.co/datasets/OpenClaw/clawhub-security-signals` |
| Paper | arXiv:2606.01494 |
| Data classification inside ARL | Third-party public research data; untrusted input |
| Raw content in production DB | No |
| Public skill slug in production DB | No; SHA-256 only |
| VirusTotal-derived per-record fields in production DB/UI | No |
| Customer evidence status | `external_reference` only |
| Can change deployment decision | No |
| Upstream endorsement claimed | No |
| Licence evidence | Exact upstream LICENSE text supplied at import, retained in `external_intelligence_corpora.license_text`, with SHA-256 stored in `license_text_sha256` |
| Dataset integrity evidence | Exact source revision plus exact filename/split/row-count/SHA-256 checks for all four JSONL files, per-import file-set SHA-256 and manifest SHA-256 |
| Eval holdout policy | Final evaluation only; no tuning/training/rule development |
| Retention | Derived metadata may be retained; raw JSONL remains outside Git/web root and is governed separately |
| Removal | Delete corpus row; foreign-key cascade removes derived records/aggregates only |

### Current legal/terms control

The OpenClaw dataset card declares the frozen dataset MIT-licensed and describes the published content as sanitized research data. AgentRiskLayer relies on that upstream licence for the permitted dataset use documented above.

VirusTotal's public API documentation prohibits use of the Public API in commercial products or services. AgentRiskLayer therefore does not call that API for this integration and does not persist or expose the dataset's top-level `virustotal_*` fields to customers. A future direct VirusTotal integration requires a separately reviewed commercial licence/agreement and owner approval.

### Review trigger

Re-review this record before:

- changing from the pinned frozen corpus to the live dataset;
- exposing per-record third-party scanner results to customers;
- retaining raw skill or bundle text;
- adding automated remote synchronization;
- making comparative accuracy claims;
- changing an upstream licence or terms-of-service dependency.
