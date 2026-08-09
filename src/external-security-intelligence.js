import crypto from 'node:crypto';
import { db, nowIso } from './db.js';
import {
  CLAWHUB_CORPUS_ID,
  projectClawHubRecord,
  serialiseAggregateMap,
} from './external-security-intelligence-core.js';

function text(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function sha256(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }

export async function registerExternalCorpus({
  id = CLAWHUB_CORPUS_ID,
  sourceName,
  datasetName,
  sourceUrl,
  sourceRevision,
  licenseSpdx,
  licenseText,
  manifestSha256,
  importFileSha256,
  notes = '',
}) {
  const licenseTextSha256 = sha256(licenseText);
  const importedAt = nowIso();
  await db.prepare(`INSERT INTO external_intelligence_corpora
    (id,source_name,dataset_name,source_url,source_revision,license_spdx,license_text_sha256,
     manifest_sha256,import_file_sha256,row_count,import_status,raw_content_retained,virustotal_customer_visible,usage_policy,notes,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,'importing',0,0,'reference_and_benchmark',?,?)
    ON CONFLICT(id) DO UPDATE SET
      source_name=excluded.source_name,dataset_name=excluded.dataset_name,source_url=excluded.source_url,
      source_revision=excluded.source_revision,license_spdx=excluded.license_spdx,
      license_text_sha256=excluded.license_text_sha256,manifest_sha256=excluded.manifest_sha256,
      import_file_sha256=excluded.import_file_sha256,row_count=0,import_status='importing',raw_content_retained=0,virustotal_customer_visible=0,
      usage_policy='reference_and_benchmark',notes=excluded.notes,imported_at=excluded.imported_at`)
    .run(text(id, 120), text(sourceName, 160), text(datasetName, 200), text(sourceUrl, 500), text(sourceRevision, 80),
      text(licenseSpdx, 32), licenseTextSha256, text(manifestSha256, 64), text(importFileSha256, 64), text(notes, 2000), importedAt);
  return { id: text(id, 120), licenseTextSha256, importedAt };
}

export async function upsertExternalIntelligenceBatch(corpusId, rows) {
  const projectedRows = rows.map((row) => projectClawHubRecord(row));
  if (!projectedRows.length) return [];
  if (projectedRows.length > 500) throw new Error('External intelligence batch exceeds 500 rows.');
  const columnsPerRow = 19;
  const groups = projectedRows.map(() => `(${Array.from({ length: columnsPerRow }, () => '?').join(',')})`).join(',');
  const values = [];
  const importedAt = nowIso();
  for (const projected of projectedRows) {
    values.push(
      `ext_${projected.sourceRecordId}`, text(corpusId, 120), projected.sourceRecordId, projected.split,
      projected.skillSlugSha256, projected.skillVersion, projected.clawscanVerdict, projected.clawscanConfidence,
      projected.clawscanModel, projected.staticStatus, projected.staticFindingCount, JSON.stringify(projected.staticReasonCodes),
      projected.skillspectorStatus, projected.skillspectorScore, projected.skillspectorSeverity, projected.skillspectorIssueCount,
      JSON.stringify(projected.skillspectorIssueCodes), JSON.stringify(projected.skillspectorIssueCategories), importedAt,
    );
  }
  await db.prepare(`INSERT INTO external_intelligence_records
    (id,corpus_id,source_record_id,split,skill_slug_sha256,skill_version,clawscan_verdict,clawscan_confidence,
     clawscan_model,static_status,static_finding_count,static_reason_codes_json,skillspector_status,
     skillspector_score,skillspector_severity,skillspector_issue_count,skillspector_issue_codes_json,
     skillspector_issue_categories_json,imported_at)
    VALUES ${groups}
    ON CONFLICT(corpus_id,source_record_id) DO UPDATE SET
      split=excluded.split,skill_slug_sha256=excluded.skill_slug_sha256,skill_version=excluded.skill_version,
      clawscan_verdict=excluded.clawscan_verdict,clawscan_confidence=excluded.clawscan_confidence,
      clawscan_model=excluded.clawscan_model,static_status=excluded.static_status,
      static_finding_count=excluded.static_finding_count,static_reason_codes_json=excluded.static_reason_codes_json,
      skillspector_status=excluded.skillspector_status,skillspector_score=excluded.skillspector_score,
      skillspector_severity=excluded.skillspector_severity,skillspector_issue_count=excluded.skillspector_issue_count,
      skillspector_issue_codes_json=excluded.skillspector_issue_codes_json,
      skillspector_issue_categories_json=excluded.skillspector_issue_categories_json,imported_at=excluded.imported_at`)
    .run(...values);
  return projectedRows;
}

export async function upsertExternalIntelligenceRecord(corpusId, row) {
  return (await upsertExternalIntelligenceBatch(corpusId, [row]))[0];
}

export async function replaceExternalIntelligenceAggregates(corpusId, aggregateMap) {
  const rows = serialiseAggregateMap(aggregateMap);
  await db.transaction(async () => {
    await db.prepare('DELETE FROM external_intelligence_aggregates WHERE corpus_id=?').run(text(corpusId, 120));
    for (const row of rows) {
      await db.prepare(`INSERT INTO external_intelligence_aggregates
        (corpus_id,signal_namespace,signal_value,row_count,updated_at) VALUES (?,?,?,?,?)`)
        .run(text(corpusId, 120), row.namespace, row.value, row.rowCount, nowIso());
    }
  });
  return rows.length;
}

export async function finaliseExternalCorpusImport(corpusId, rowCount) {
  await db.prepare("UPDATE external_intelligence_corpora SET row_count=?,import_status='complete',imported_at=? WHERE id=?")
    .run(Number(rowCount) || 0, nowIso(), text(corpusId, 120));
}

export async function externalIntelligenceStatus(corpusId = CLAWHUB_CORPUS_ID) {
  const corpus = await db.prepare(`SELECT id,source_name,dataset_name,source_revision,license_spdx,license_text_sha256,
    manifest_sha256,import_file_sha256,row_count,import_status,raw_content_retained,virustotal_customer_visible,usage_policy,imported_at
    FROM external_intelligence_corpora WHERE id=?`).get(text(corpusId, 120));
  if (!corpus) return null;
  return {
    ...corpus,
    rawContentRetained: Boolean(corpus.raw_content_retained),
    virusTotalCustomerVisible: Boolean(corpus.virustotal_customer_visible),
  };
}

export async function markExternalCorpusImportFailed(corpusId) {
  await db.prepare("UPDATE external_intelligence_corpora SET import_status='failed',imported_at=? WHERE id=?")
    .run(nowIso(), text(corpusId, 120));
}
