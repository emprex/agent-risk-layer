CREATE TABLE IF NOT EXISTS sales_prospects (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT,
  company_size TEXT,
  buyer_name TEXT,
  buyer_role TEXT,
  buyer_email TEXT,
  buyer_linkedin TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  trigger_signal TEXT,
  agent_use_case TEXT,
  tool_access TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  score_reasons_json TEXT NOT NULL DEFAULT '[]',
  stage TEXT NOT NULL DEFAULT 'research',
  estimated_value_pence INTEGER NOT NULL DEFAULT 9900,
  next_action TEXT,
  next_action_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_messages (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  message_type TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  factual_basis_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  sent_at TEXT,
  response_outcome TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_activities (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  outcome TEXT,
  detail TEXT,
  amount_pence INTEGER,
  occurred_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_prospects_stage ON sales_prospects(stage, score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_prospects_next_action ON sales_prospects(next_action_at, stage);
CREATE INDEX IF NOT EXISTS idx_sales_messages_prospect ON sales_messages(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_messages_status ON sales_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_activities_prospect ON sales_activities(prospect_id, occurred_at DESC);
