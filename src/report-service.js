import crypto from 'node:crypto';
import { db } from './db.js';
import { latestInspection } from './inspector.js';
import { latestRedTeamRun } from './redteam.js';
import { buildReport } from './report.js';
export async function buildAssessmentReport(assessmentId, tier = null) {
    const assessment = await db.prepare('SELECT * FROM assessments WHERE id=?').get(assessmentId);
    if (!assessment)
        throw new Error('Assessment not found.');
    const effectiveTier = tier || assessment.paid_tier;
    const inspection = await latestInspection(assessmentId);
    const redTeam = await latestRedTeamRun(assessmentId);
    const report = buildReport(assessment, effectiveTier, inspection, redTeam);
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
