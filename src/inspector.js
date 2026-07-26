import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, id, nowIso } from './db.js';
import { config } from './config.js';
export const INSPECTION_SCHEMA = 'arl.inspection.bundle.v1';
export const INSPECTION_TOKEN_TTL_MS = 15 * 60000;
export const MAX_INSPECTION_AGE_MS = 24 * 60 * 60000;
export const MAX_FINDINGS = 500;
export async function createInspectionToken({ userId, assessmentId }) {
    const assessment = await db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, userId);
    if (!assessment)
        throw new Error('Assessment not found.');
    const raw = `scan_${crypto.randomBytes(32).toString('base64url')}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + INSPECTION_TOKEN_TTL_MS).toISOString();
    await db.prepare(`
    INSERT INTO inspection_tokens (id, token_hash, user_id, assessment_id, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(id('itk_'), hashToken(raw), userId, assessmentId, expiresAt, createdAt);
    return { token: raw, expiresAt, assessmentId };
}
export async function consumeInspectionUpload({ rawToken, bundle }) {
    if (!rawToken || !rawToken.startsWith('scan_'))
        throw new Error('Inspection token missing or invalid.');
    const tokenHash = hashToken(rawToken);
    const tokenRow = await db.prepare(`
    SELECT * FROM inspection_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(tokenHash, nowIso());
    if (!tokenRow)
        throw new Error('Inspection token is invalid, expired, or already used.');
    const validation = validateInspectionBundle(bundle);
    if (!validation.valid)
        throw new Error(`Evidence bundle rejected: ${validation.error}`);
    const createdAt = nowIso();
    const inspectionId = id('ins_');
    const findings = normaliseFindings(bundle.findings);
    const summary = recomputeSummary(findings, normaliseSummary(bundle.summary));
    const subject = normaliseObject(bundle.subject, 20);
    const scope = normaliseObject(bundle.scope, 30);
    const technologies = Array.isArray(bundle.observedTechnologies)
        ? bundle.observedTechnologies.slice(0, 100).map((value) => clean(value, 120))
        : [];
    const previousRow = await db.prepare('SELECT id, summary_json, findings_json FROM inspections WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 1').get(tokenRow.assessment_id);
    const delta = buildInspectionDelta(previousRow, summary, findings);
    const trust = {
        signatureValid: true,
        digest: validation.digest,
        evidenceClass: clean(bundle.trust?.evidenceClass || 'locally-observed-static-evidence', 80),
        scannerVersion: clean(bundle.scanner?.version, 30),
        policyVersion: clean(bundle.scanner?.policyVersion, 80),
        scannerBuildDigest: clean(bundle.scanner?.buildDigest, 64),
        reportedReleaseDigestMatched: true,
        receivedAt: createdAt,
        boundary: 'Integrity-verified local evidence. AgentRiskLayer did not execute the scan and does not claim independent custody or complete runtime coverage.',
    };
    await db.transaction(async () => {
        const claimed = await db.prepare(`
      UPDATE inspection_tokens SET used_at = ?
      WHERE id = ? AND used_at IS NULL AND expires_at > ?
    `).run(createdAt, tokenRow.id, createdAt);
        if (claimed.changes !== 1)
            throw new Error('Inspection token is invalid, expired, or already used.');
        if (await db.prepare('SELECT 1 AS ok FROM inspections WHERE bundle_digest = ?').get(validation.digest)) {
            throw new Error('This evidence bundle has already been uploaded.');
        }
        await db.prepare(`
      INSERT INTO inspections
      (id, user_id, assessment_id, schema_version, scanner_version, policy_version,
       bundle_digest, signature_valid, subject_json, scope_json, summary_json,
       findings_json, technologies_json, trust_json, delta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(inspectionId, tokenRow.user_id, tokenRow.assessment_id, bundle.schema, trust.scannerVersion, trust.policyVersion, validation.digest, JSON.stringify(subject), JSON.stringify(scope), JSON.stringify(summary), JSON.stringify(findings), JSON.stringify(technologies), JSON.stringify(trust), JSON.stringify(delta), createdAt);
        await db.prepare('UPDATE assessments SET updated_at = ? WHERE id = ?').run(createdAt, tokenRow.assessment_id);
        await db.prepare(`
      INSERT INTO events (id, user_id, name, properties_json, created_at)
      VALUES (?, ?, 'inspection_uploaded', ?, ?)
    `).run(id('evt_'), tokenRow.user_id, JSON.stringify({
            inspectionId, assessmentId: tokenRow.assessment_id,
            technicalRisk: summary.technicalRisk, postureScore: summary.postureScore,
            critical: summary.counts.critical, high: summary.counts.high,
        }), createdAt);
    });
    return { inspectionId, assessmentId: tokenRow.assessment_id, summary, trust, delta };
}
export async function listInspectionsForAssessment({ assessmentId, userId }) {
    const owner = await db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, userId);
    if (!owner)
        throw new Error('Assessment not found.');
    return (await db.prepare(`
    SELECT id, assessment_id, scanner_version, policy_version, bundle_digest,
           signature_valid, subject_json, scope_json, summary_json, technologies_json,
           trust_json, delta_json, created_at
    FROM inspections WHERE assessment_id = ? AND user_id = ? ORDER BY created_at DESC
  `).all(assessmentId, userId)).map(publicInspectionSummary);
}
export async function getInspection({ inspectionId, userId }) {
    const row = await db.prepare('SELECT * FROM inspections WHERE id = ? AND user_id = ?').get(inspectionId, userId);
    return row ? publicInspection(row, true) : null;
}
export async function latestInspection(assessmentId) {
    const row = await db.prepare('SELECT * FROM inspections WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 1').get(assessmentId);
    return row ? publicInspection(row, true) : null;
}
export function attachInspectionToResult(result, inspection) {
    if (!inspection)
        return result;
    const observedCritical = inspection.summary.counts.critical || 0;
    const observedHigh = inspection.summary.counts.high || 0;
    const technicalRisk = inspection.summary.technicalRisk || 0;
    let decision = result.decision;
    if (observedCritical > 0)
        decision = 'DO NOT DEPLOY';
    else if (observedHigh > 0 && !String(decision).startsWith('DO NOT'))
        decision = 'DEPLOY ONLY AFTER MATERIAL REMEDIATION';
    const assurance = inspection.scope?.truncatedByLimit || (inspection.scope?.userExclusions || []).length
        ? 'PARTIAL TECHNICAL EVIDENCE'
        : 'INTEGRITY-VERIFIED TECHNICAL EVIDENCE';
    return {
        ...result,
        decision,
        inspection: {
            id: inspection.id,
            createdAt: inspection.createdAt,
            scannerVersion: inspection.scannerVersion,
            policyVersion: inspection.policyVersion,
            summary: inspection.summary,
            trust: inspection.trust,
            scope: inspection.scope,
            subject: inspection.subject,
            technologies: inspection.technologies,
            delta: inspection.delta,
            findings: inspection.findings,
            assurance,
        },
        headline: observedCritical > 0
            ? `${result.headline} A local inspection also observed critical technical weaknesses.`
            : observedHigh > 0
                ? `${result.headline} A local inspection observed material technical weaknesses.`
                : `${result.headline} A local inspection found no critical static issue within its declared scope.`,
        scoring: {
            ...(result.scoring || {}),
            declaredResidualRisk: result.score,
            observedTechnicalRisk: technicalRisk,
            inspectionDoesNotLowerDeclaredRisk: true,
        },
    };
}
function buildInspectionDelta(previousRow, currentSummary, currentFindings) {
    if (!previousRow)
        return { status: 'first-scan', baselineInspectionId: null, newFindings: currentFindings.map(findingKey), resolvedFindings: [], unchangedCount: 0, technicalRiskChange: null, postureChange: null };
    const previousSummary = parse(previousRow.summary_json);
    const previousFindings = Array.isArray(parse(previousRow.findings_json)) ? parse(previousRow.findings_json) : [];
    const before = new Map(previousFindings.map((item) => [findingKey(item), item]));
    const after = new Map(currentFindings.map((item) => [findingKey(item), item]));
    const newFindings = [...after.keys()].filter((key) => !before.has(key));
    const resolvedFindings = [...before.keys()].filter((key) => !after.has(key));
    const unchangedCount = [...after.keys()].filter((key) => before.has(key)).length;
    return {
        status: newFindings.length || resolvedFindings.length ? 'changed' : 'no-change',
        baselineInspectionId: previousRow.id,
        newFindings, resolvedFindings, unchangedCount,
        technicalRiskChange: Number(currentSummary.technicalRisk || 0) - Number(previousSummary.technicalRisk || 0),
        postureChange: Number(currentSummary.postureScore || 0) - Number(previousSummary.postureScore || 0),
    };
}
function findingKey(item) {
    const evidence = Array.isArray(item.evidence) ? item.evidence.map((entry) => `${entry.pathHash || entry.basename || ''}:${entry.line || ''}`).sort().join('|') : '';
    return `${clean(item.ruleId, 40)}:${evidence}`;
}
export function validateInspectionBundle(bundle) {
    try {
        if (!bundle || typeof bundle !== 'object')
            return invalid('Bundle must be a JSON object.');
        if (bundle.schema !== INSPECTION_SCHEMA)
            return invalid('Unsupported schema.');
        if (!bundle.integrity || typeof bundle.integrity !== 'object')
            return invalid('Integrity block is missing.');
        if (!bundle.scanner || !/^(?:3|4)\./.test(String(bundle.scanner.version || '')))
            return invalid('Unsupported scanner version.');
        const officialDigest = officialScannerDigest();
        if (!officialDigest || !safeEqual(officialDigest, String(bundle.scanner.buildDigest || '')))
            return invalid('Reported scanner build digest does not match the published AgentRisk Inspector release.');
        if (!bundle.attestations?.authorisedByOperator)
            return invalid('Operator authorisation was not attested.');
        if (!bundle.attestations?.readOnlyInspection || !bundle.attestations?.noSourceCodeUploaded || !bundle.attestations?.noSecretValuesUploaded) {
            return invalid('Required privacy and read-only attestations are missing.');
        }
        const generatedAt = Date.parse(bundle.generatedAt);
        if (!Number.isFinite(generatedAt))
            return invalid('Invalid generatedAt timestamp.');
        if (generatedAt > Date.now() + 5 * 60000)
            return invalid('Bundle timestamp is in the future.');
        if (Date.now() - generatedAt > MAX_INSPECTION_AGE_MS)
            return invalid('Bundle is older than 24 hours. Generate a fresh inspection.');
        if (!Array.isArray(bundle.findings) || bundle.findings.length > MAX_FINDINGS)
            return invalid('Finding count exceeds the accepted limit.');
        if (containsForbiddenEvidence({ subject: bundle.subject, scope: bundle.scope, findings: bundle.findings, observedTechnologies: bundle.observedTechnologies, acceptedRiskReviews: bundle.acceptedRiskReviews, trust: bundle.trust }))
            return invalid('Evidence contains raw content or secret-like values.');
        const { integrity, ...payload } = bundle;
        const canonical = canonicalJson(payload);
        const digest = sha256(canonical);
        if (!safeEqual(digest, String(integrity.digest || '')))
            return invalid('Digest mismatch.');
        if (integrity.signatureAlgorithm !== 'Ed25519')
            return invalid('Unsupported signature algorithm.');
        const publicKey = crypto.createPublicKey({
            key: Buffer.from(String(integrity.publicKeySpki || ''), 'base64'),
            type: 'spki', format: 'der',
        });
        const valid = crypto.verify(null, Buffer.from(canonical), publicKey, Buffer.from(String(integrity.signature || ''), 'base64'));
        return valid ? { valid: true, digest } : invalid('Signature mismatch.');
    }
    catch (error) {
        return invalid(error.message);
    }
}
function containsForbiddenEvidence(findings) {
    const forbiddenKeys = new Set(['content', 'sourceCode', 'source_code', 'secret', 'secretValue', 'secret_value', 'match', 'matchedValue', 'raw']);
    const secretLike = /\b(?:sk_(?:live|test)_|sk-ant-|gh[pousr]_|AKIA[A-Z0-9]{12}|-----BEGIN .*PRIVATE KEY-----)/;
    const visit = (value, depth = 0) => {
        if (depth > 8)
            return true;
        if (typeof value === 'string')
            return value.length > 1000 || secretLike.test(value);
        if (Array.isArray(value))
            return value.some((item) => visit(item, depth + 1));
        if (value && typeof value === 'object') {
            return Object.entries(value).some(([key, item]) => forbiddenKeys.has(key) || visit(item, depth + 1));
        }
        return false;
    };
    return visit(findings);
}
function recomputeSummary(findings, submitted) {
    const weights = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
    const confidence = { high: 1, medium: 0.75, low: 0.5 };
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let risk = 0;
    const activeFindings = findings.filter((item) => item.review?.status !== 'false-positive');
    for (const item of activeFindings) {
        counts[item.severity] += 1;
        risk += weights[item.severity] * confidence[item.confidence];
    }
    risk = Math.min(100, Math.round(risk));
    const postureScore = Math.max(0, 100 - risk);
    const grade = postureScore >= 90 ? 'A' : postureScore >= 80 ? 'B' : postureScore >= 65 ? 'C' : postureScore >= 50 ? 'D' : 'F';
    const conclusion = counts.critical
        ? 'Critical observed weaknesses require immediate remediation before relying on the inspected system.'
        : counts.high
            ? 'Material observed weaknesses should be remediated before broader deployment.'
            : counts.medium
                ? 'No critical issue was observed, but important hardening and assurance work remains.'
                : 'No material issue was observed by this static inspection. Runtime and cloud controls remain outside scope.';
    return {
        ...submitted,
        postureScore,
        technicalRisk: risk,
        grade,
        counts,
        findingsTotal: findings.length,
        activeFindingsTotal: activeFindings.length,
        falsePositiveTotal: findings.filter((item) => item.review?.status === 'false-positive').length,
        acceptedRiskTotal: findings.filter((item) => item.review?.status === 'accepted-risk').length,
        highestSeverity: counts.critical ? 'critical' : counts.high ? 'high' : counts.medium ? 'medium' : counts.low ? 'low' : 'none',
        conclusion,
    };
}
function normaliseSummary(input = {}) {
    const counts = input.counts || {};
    return {
        postureScore: clampInt(input.postureScore, 0, 100),
        technicalRisk: clampInt(input.technicalRisk, 0, 100),
        grade: clean(input.grade, 2),
        counts: {
            critical: clampInt(counts.critical, 0, MAX_FINDINGS),
            high: clampInt(counts.high, 0, MAX_FINDINGS),
            medium: clampInt(counts.medium, 0, MAX_FINDINGS),
            low: clampInt(counts.low, 0, MAX_FINDINGS),
            info: clampInt(counts.info, 0, MAX_FINDINGS),
        },
        checksEvaluated: clampInt(input.checksEvaluated, 0, 5000),
        findingsTotal: clampInt(input.findingsTotal, 0, MAX_FINDINGS),
        activeFindingsTotal: clampInt(input.activeFindingsTotal, 0, MAX_FINDINGS),
        falsePositiveTotal: clampInt(input.falsePositiveTotal, 0, MAX_FINDINGS),
        acceptedRiskTotal: clampInt(input.acceptedRiskTotal, 0, MAX_FINDINGS),
        highestSeverity: clean(input.highestSeverity, 20),
        conclusion: clean(input.conclusion, 500),
        repositoryTracking: clean(input.repositoryTracking, 40),
    };
}
function normaliseFindings(findings) {
    return findings.slice(0, MAX_FINDINGS).map((finding) => ({
        ruleId: clean(finding.ruleId, 40), title: clean(finding.title, 180),
        severity: ['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity) ? finding.severity : 'medium',
        confidence: ['high', 'medium', 'low'].includes(finding.confidence) ? finding.confidence : 'low',
        category: clean(finding.category, 80), summary: clean(finding.summary, 700),
        remediation: clean(finding.remediation, 900),
        frameworks: Array.isArray(finding.frameworks) ? finding.frameworks.slice(0, 20).map((value) => clean(value, 140)) : [],
        evidence: Array.isArray(finding.evidence) ? finding.evidence.slice(0, 12).map((entry) => ({
            source: clean(entry.source, 50), basename: clean(entry.basename, 120),
            relativePath: entry.relativePath ? clean(entry.relativePath, 240) : null,
            pathHash: clean(entry.pathHash, 64), line: Number.isInteger(entry.line) ? entry.line : null,
            fact: clean(entry.fact, 240),
        })) : [],
        review: finding.review && typeof finding.review === 'object' ? {
            status: ['accepted-risk', 'false-positive', 'expired-review'].includes(finding.review.status) ? finding.review.status : 'expired-review',
            reason: clean(finding.review.reason, 400), owner: clean(finding.review.owner, 120),
            expires: finding.review.expires ? clean(finding.review.expires, 30) : null,
            expired: Boolean(finding.review.expired),
        } : null,
    }));
}
function publicInspection(row, includeFindings) {
    return {
        id: row.id, assessmentId: row.assessment_id, schemaVersion: row.schema_version,
        scannerVersion: row.scanner_version, policyVersion: row.policy_version,
        digest: row.bundle_digest, signatureValid: Boolean(row.signature_valid),
        subject: parse(row.subject_json), scope: parse(row.scope_json), summary: parse(row.summary_json),
        technologies: parse(row.technologies_json), trust: parse(row.trust_json), delta: parse(row.delta_json),
        findings: includeFindings ? parse(row.findings_json) : undefined,
        createdAt: row.created_at,
    };
}
function publicInspectionSummary(row) { return publicInspection(row, false); }
function parse(value) {
    try {
        return JSON.parse(value || '{}');
    }
    catch {
        return {};
    }
}
function normaliseObject(input, maxKeys) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return {};
    return Object.fromEntries(Object.entries(input).slice(0, maxKeys).map(([key, value]) => [clean(key, 80), normaliseValue(value, 0)]));
}
function normaliseValue(value, depth) {
    if (depth > 4)
        return null;
    if (typeof value === 'string')
        return clean(value, 500);
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value === null)
        return value;
    if (Array.isArray(value))
        return value.slice(0, 100).map((item) => normaliseValue(item, depth + 1));
    if (typeof value === 'object')
        return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [clean(k, 80), normaliseValue(v, depth + 1)]));
    return null;
}
function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function officialScannerDigest() {
    try {
        return sha256(fs.readFileSync(path.resolve(process.cwd(), 'public', 'downloads', 'agent-risk-inspector.mjs'), 'utf8').replace(/\r\n/g, '\n'));
    }
    catch {
        return null;
    }
}
function hashToken(token) { return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function clean(value, max) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function clampInt(value, min, max) { const num = Math.round(Number(value)); return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : min; }
function invalid(error) { return { valid: false, error }; }
