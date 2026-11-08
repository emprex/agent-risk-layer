-- E07-02A: operator-owned, versioned ARL sellable service catalogue.
-- Local metadata ONLY: does not verify technical delivery, authorise a security test,
-- approve tax treatment, issue a quote, create a contract or charge a customer.
-- No service names, prices or technical claims are seeded by the migration.
CREATE TABLE enkyron_crm_service_catalog (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 service_code TEXT NOT NULL CHECK(service_code ~ '^[A-Z][A-Z0-9_-]{2,47}$'),
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 5 AND 160),
 family TEXT NOT NULL CHECK(family IN
   ('agent_assessment','mcp_api','security_testing','remediation_retest','advisory','continuous','other')),
 summary TEXT NOT NULL CHECK(length(btrim(summary)) BETWEEN 20 AND 1200),
 inclusions TEXT NOT NULL CHECK(length(btrim(inclusions)) BETWEEN 20 AND 3000),
 exclusions TEXT NOT NULL CHECK(length(btrim(exclusions)) BETWEEN 20 AND 3000),
 deliverables TEXT NOT NULL CHECK(length(btrim(deliverables)) BETWEEN 20 AND 3000),
 prerequisites TEXT NOT NULL CHECK(length(btrim(prerequisites)) BETWEEN 20 AND 3000),
 technical_notes TEXT,
 pricing_model TEXT NOT NULL CHECK(pricing_model IN ('fixed','custom_quote','recurring')),
 currency TEXT NOT NULL CHECK(currency IN ('GBP','EUR','USD')),
 price_minor BIGINT CHECK(price_minor BETWEEN 1 AND 999999999),
 billing_period TEXT CHECK(billing_period IN ('monthly','quarterly','yearly')),
 status TEXT NOT NULL CHECK(status IN ('draft','available','retired')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 20 AND 1200),
 updated_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT enkyron_catalog_scoped_id UNIQUE(workspace_key,id),
 CONSTRAINT enkyron_catalog_scoped_code UNIQUE(workspace_key,service_code),
 CONSTRAINT enkyron_catalog_price_coherence CHECK(
   (pricing_model='custom_quote' AND price_minor IS NULL AND billing_period IS NULL)
   OR (pricing_model='fixed' AND billing_period IS NULL
       AND (status<>'available' OR price_minor IS NOT NULL))
   OR (pricing_model='recurring' AND billing_period IS NOT NULL
       AND (status<>'available' OR price_minor IS NOT NULL))),
 CONSTRAINT enkyron_catalog_technical_note_limit CHECK(
   technical_notes IS NULL OR length(btrim(technical_notes)) BETWEEN 20 AND 3000)
);
CREATE INDEX enkyron_catalog_browse
 ON enkyron_crm_service_catalog(workspace_key,status,family,service_code);
CREATE TABLE enkyron_crm_service_catalog_versions (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 service_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1),
 service_code TEXT NOT NULL,
 name TEXT NOT NULL,
 family TEXT NOT NULL,
 summary TEXT NOT NULL,
 inclusions TEXT NOT NULL,
 exclusions TEXT NOT NULL,
 deliverables TEXT NOT NULL,
 prerequisites TEXT NOT NULL,
 technical_notes TEXT,
 pricing_model TEXT NOT NULL,
 currency TEXT NOT NULL,
 price_minor BIGINT,
 billing_period TEXT,
 status TEXT NOT NULL,
 review_note TEXT NOT NULL,
 recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 CONSTRAINT enkyron_catalog_version_scoped_service
   FOREIGN KEY(workspace_key,service_id)
   REFERENCES enkyron_crm_service_catalog(workspace_key,id) ON DELETE RESTRICT,
 CONSTRAINT enkyron_catalog_version_unique UNIQUE(workspace_key,service_id,revision)
);
CREATE INDEX enkyron_catalog_version_history
 ON enkyron_crm_service_catalog_versions(workspace_key,service_id,revision DESC);
CREATE TRIGGER enkyron_catalog_versions_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_service_catalog_versions
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

-- Snapshot provenance for a quote line may refer to one immutable catalog fiche
-- version. The line's description and fee stay COPIED in draft/version tables:
-- editing a catalog fiche never reprices or rewrites an existing quote.
ALTER TABLE enkyron_crm_proposal_lines
 ADD COLUMN source_catalog_id TEXT,
 ADD COLUMN source_catalog_revision INTEGER,
 ADD CONSTRAINT enkyron_quote_line_catalog_pair CHECK(
   (source_catalog_id IS NULL AND source_catalog_revision IS NULL) OR
   (source_catalog_id IS NOT NULL AND source_catalog_revision>=1)),
 ADD CONSTRAINT enkyron_quote_line_catalog_fk
 FOREIGN KEY(workspace_key,source_catalog_id,source_catalog_revision)
 REFERENCES enkyron_crm_service_catalog_versions(workspace_key,service_id,revision)
 ON DELETE RESTRICT;
ALTER TABLE enkyron_crm_proposal_line_versions
 ADD COLUMN source_catalog_id TEXT,
 ADD COLUMN source_catalog_revision INTEGER,
 ADD CONSTRAINT enkyron_quote_version_catalog_pair CHECK(
   (source_catalog_id IS NULL AND source_catalog_revision IS NULL) OR
   (source_catalog_id IS NOT NULL AND source_catalog_revision>=1)),
 ADD CONSTRAINT enkyron_quote_version_catalog_fk
 FOREIGN KEY(workspace_key,source_catalog_id,source_catalog_revision)
 REFERENCES enkyron_crm_service_catalog_versions(workspace_key,service_id,revision)
 ON DELETE RESTRICT;
