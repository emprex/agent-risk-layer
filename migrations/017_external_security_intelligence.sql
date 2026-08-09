-- Additive external security-intelligence reference corpus storage.
-- Raw corpus content and VirusTotal-derived fields are intentionally excluded from production tables.
CREATE TABLE IF NOT EXISTS external_intelligence_corpora (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_revision TEXT NOT NULL CHECK (length(source_revision)=40),
  license_spdx TEXT NOT NULL,
  license_text_sha256 TEXT NOT NULL CHECK (length(license_text_sha256)=64),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256)=64),
  import_file_sha256 TEXT NOT NULL CHECK (length(import_file_sha256)=64),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  import_status TEXT NOT NULL DEFAULT 'importing' CHECK (import_status IN ('importing','complete','failed')),
  raw_content_retained INTEGER NOT NULL DEFAULT 0 CHECK (raw_content_retained IN (0,1)),
  virustotal_customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (virustotal_customer_visible IN (0,1)),
  usage_policy TEXT NOT NULL CHECK (usage_policy IN ('reference_and_benchmark')),
  notes TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_intelligence_records (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES external_intelligence_corpora(id) ON DELETE CASCADE,
  source_record_id TEXT NOT NULL CHECK (length(source_record_id)=64),
  split TEXT NOT NULL CHECK (split IN ('train','validation','test','eval_holdout')),
  skill_slug_sha256 TEXT NOT NULL CHECK (length(skill_slug_sha256)=64),
  skill_version TEXT NOT NULL DEFAULT '',
  clawscan_verdict TEXT NOT NULL CHECK (clawscan_verdict IN ('clean','suspicious','malicious','unknown')),
  clawscan_confidence TEXT,
  clawscan_model TEXT,
  static_status TEXT,
  static_finding_count INTEGER NOT NULL DEFAULT 0 CHECK (static_finding_count >= 0),
  static_reason_codes_json TEXT NOT NULL DEFAULT '[]',
  skillspector_status TEXT,
  skillspector_score NUMERIC,
  skillspector_severity TEXT,
  skillspector_issue_count INTEGER NOT NULL DEFAULT 0 CHECK (skillspector_issue_count >= 0),
  skillspector_issue_codes_json TEXT NOT NULL DEFAULT '[]',
  skillspector_issue_categories_json TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL,
  UNIQUE(corpus_id,source_record_id)
);

CREATE TABLE IF NOT EXISTS external_intelligence_aggregates (
  corpus_id TEXT NOT NULL REFERENCES external_intelligence_corpora(id) ON DELETE CASCADE,
  signal_namespace TEXT NOT NULL CHECK (signal_namespace IN ('clawscan_verdict','static_reason_code','skillspector_category')),
  signal_value TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(corpus_id,signal_namespace,signal_value)
);

CREATE INDEX IF NOT EXISTS idx_external_intelligence_records_split
  ON external_intelligence_records(corpus_id,split);
CREATE INDEX IF NOT EXISTS idx_external_intelligence_records_clawscan
  ON external_intelligence_records(corpus_id,clawscan_verdict);
CREATE INDEX IF NOT EXISTS idx_external_intelligence_records_static
  ON external_intelligence_records(corpus_id,static_status);
CREATE INDEX IF NOT EXISTS idx_external_intelligence_records_skillspector
  ON external_intelligence_records(corpus_id,skillspector_status);
