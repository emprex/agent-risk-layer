import crypto from 'node:crypto';
import { db } from './db.js';
import { latestInspection } from './inspector.js';
import { latestRedTeamRun } from './redteam.js';
import { buildReport } from './report.js';
import { getControlIntelligenceReportSummary } from './control-intelligence.js';
export async function buildAssessmentReport(assessmentId, tier = null) {
    const assessment = await db.prepare('SELECT * FROM assessments WHERE id=?').get(assessmentId);
    if (!assessment)
        throw new Error('Assessment not found.');
    const effectiveTier = tier || assessment.paid_tier;
    const inspection = await latestInspection(assessmentId);
    const redTeam = await latestRedTeamRun(assessmentId);
    const report = buildReport(assessment, effectiveTier, inspection, redTeam);
    const linkedProject=await db.prepare('SELECT project_id FROM remediation_items WHERE assessment_id=? ORDER BY updated_at DESC LIMIT 1').get(assessmentId);
    report.controlIntelligence=linkedProject?await getControlIntelligenceReportSummary({projectId:linkedProject.project_id}):null;
    return {
        assessment,
        tier: effectiveTier,
        inspection,
        redTeam,
        report,
        digest: crypto.createHash('sha256').update(canonicalJson(report)).digest('hex'),
    };
}
function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
