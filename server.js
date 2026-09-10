import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertSafeProductionConfig, config, launchReadiness } from './src/config.js';
import { db, id, initialiseDatabase, insertEvent, nowIso } from './src/db.js';
import { authenticateUser, beginMfaSetup, changePassword, clearSession, completeMfaLogin, createEmailVerification, createMfaLoginChallenge, createPasswordReset, createSession, disableMfa, enableMfa, getUserFromRequest, reauthenticateSession, registerUser, resetPassword, verifyEmailToken } from './src/auth.js';
import { evaluateAssessment, questionnaire, evidenceOptions } from './src/risk-engine.js';
import { renderReportPdf } from './src/pdf.js';
import { buildAssessmentReport } from './src/report-service.js';
import { sendEmailVerification, sendPasswordChangedEmail, sendPasswordResetEmail } from './src/email.js';
import { applySecurityHeaders, cleanText, clearRateLimit, issueCsrfToken, primaryRateLimitAllowed, rateLimitAllowed, rateLimitSnapshot, verifyCsrf } from './src/security.js';
import { attachInspectionToResult, consumeInspectionUpload, createInspectionToken, getInspection, latestInspection, listInspectionsForAssessment } from './src/inspector.js';
import { runFrozenGithubSourceInspection } from './src/github-source-inspection.js';
import { attachRedTeamToResult, consumeRedTeamUpload, createRedTeamAuthorisation, createRedTeamRecoveryToken, createRedTeamToken, getRedTeamRun, latestRedTeamRun, listRedTeamAuthorisations, listRedTeamRunsForAssessment, revokeRedTeamAuthorisation } from './src/redteam.js';
import { enforceRetention, retentionOverview, startRetentionWorker } from './src/retention.js';
import { authenticateScim, configureIntegration, createScimToken, createWorkspace, deliverSecurityEvent, getWorkspace, listWorkspaces, provisionScimUser, upsertMember } from './src/workspaces.js';
import { discoverAiAssets } from './src/asset-discovery.js';
import { analyseModelArtifact } from './src/model-artifact-analysis.js';
import {
    authenticateProjectApiKey, beginLegacyRemediationUpgrade, controlPlaneOverview, createProjectApiKey, createRemediationItem, createRuntimeApproval, createSecurityProject, entitlementForUser, getSecurityProject,
    listAssetSnapshots, listProjectApiKeys, listRemediationItems, listRuntimeApprovals, listRuntimeEvents, recordAssetSnapshot,
    registerRemediationEvidenceArtifact, revokeProjectApiKey, revokeRuntimeApproval, runGuidedProtectionCheck, screenGuardRequest, updateRemediationItem, updateSecurityProject,
} from './src/control-plane.js';
import {
    buildDemoBrief, createMessage, createProspect, getProspect, listMessages, listProspects,
    recordActivity, salesOverview, updateMessage, updateProspect,
} from './src/sales-agent.js';
import {
    applyProjectRiskKnowledgeProfile, exportRiskKnowledgeEntry, getProjectEvidenceReadiness,
    getPublicRiskKnowledgeEntry, getRiskKnowledgeEntry, linkRiskKnowledge, listRiskKnowledge,
    profileRiskKnowledge, setProjectRiskKnowledgeState, riskKnowledgeFilterOptions, architecturePredicateRegistry,
} from './src/risk-knowledge.js';
import { resolveRiskKnowledgeSubject } from './src/risk-knowledge-subjects.js';
import {
    createSystemSnapshot, getControlIntelligence, getControlIntelligenceControl, assessControlApplicability, assessControlApplicabilityBatch,
    recordControlEvidence, recordControlTestExecution, recordDeploymentDecision, createControlFinding, closeControlFinding, getControlIntelligenceReportSummary,
} from './src/control-intelligence.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf',
    '.yaml': 'text/yaml; charset=utf-8',
    '.yml': 'text/yaml; charset=utf-8',
};
const expectedLatestMigration = fs.readdirSync(path.join(__dirname, 'migrations'))
    .filter((name) => /^[0-9]{3}_[a-z0-9_-]+[.]sql$/i.test(name))
    .sort()
    .at(-1) || null;
function publicDatabaseHealth(database, initialisation) {
    const migrationResult = initialisation?.migrations || {};
    const migrationVersions = [...new Set([
        ...(Array.isArray(migrationResult.applied) ? migrationResult.applied : []),
        ...(Array.isArray(migrationResult.skipped) ? migrationResult.skipped : []),
    ])].sort();
    const latestMigration = migrationVersions.at(-1) || null;
    return {
        ok: Boolean(database?.ok),
        adapter: database?.adapter || database?.kind || 'unknown',
        latencyMs: Number.isFinite(Number(database?.latencyMs)) ? Number(database.latencyMs) : null,
        schemaCurrent: Boolean(expectedLatestMigration && latestMigration === expectedLatestMigration),
        migrationCount: migrationVersions.length,
        latestMigration,
        expectedLatestMigration,
    };
}
const server = http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    const url = new URL(req.url, config.baseUrl);
    if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, version: config.appVersion, productStage: config.productStage, timestamp: nowIso() });
    }
    if (req.method === 'GET' && url.pathname === '/api/ready') {
        try {
            const database = await db.healthcheck();
            const readiness = launchReadiness();
            return json(res, readiness.ready ? 200 : 503, { ok: readiness.ready, version: config.appVersion, productStage: config.productStage, database: publicDatabaseHealth(database, databaseInitialisation), readiness, timestamp: nowIso() });
        }
        catch (error) {
            return json(res, 503, { ok: false, version: config.appVersion, productStage: config.productStage, database: { ok: false, error: 'database_unavailable' }, timestamp: nowIso() });
        }
    }
    if (req.method === 'GET' && url.pathname === '/metrics')
        return await handleMetrics(req, res);
    if (!await primaryRateLimitAllowed(req, url.pathname))
        return json(res, 429, { error: 'Too many requests. Please try again shortly.' });
    req.user = await getUserFromRequest(req);
    try {
        if (req.method === 'POST' && url.pathname === '/api/inspector/upload')
            return await handleInspectionUpload(req, res);
        if (req.method === 'POST' && url.pathname === '/api/redteam/upload')
            return await handleRedTeamUpload(req, res);
        if (req.method === 'POST' && url.pathname === '/v1/guard')
            return await handleProjectGuard(req, res);
        let scimMatch = url.pathname.match(/^\/scim\/v2\/workspaces\/([^/]+)\/Users(?:\/([^/]+))?$/);
        if (scimMatch)
            return await handleScim(req, res, decodeURIComponent(scimMatch[1]), scimMatch[2] ? decodeURIComponent(scimMatch[2]) : null);
        if (req.method === 'GET' && url.pathname === '/api/csrf')
            return json(res, 200, { csrfToken: issueCsrfToken(req, res) });
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !verifyCsrf(req)) {
            return json(res, 403, { error: 'Security token missing or invalid. Refresh the page and try again.' });
        }
        if (req.method === 'GET' && url.pathname === '/api/config') {
            return json(res, 200, {
                demoMode: config.demoMode,
                version: config.appVersion,
                productStage: config.productStage,
                termsVersion: config.termsVersion,
                supportEmail: config.supportEmail,
                user: req.user,
            });
        }
        if (req.method === 'GET' && url.pathname === '/api/questionnaire')
            return json(res, 200, { questionnaire, evidenceOptions });
        if (req.method === 'GET' && url.pathname === '/api/risk-knowledge') {
            const page = await listRiskKnowledge({
                query: url.searchParams.get('query') || '',
                category: url.searchParams.get('category') || '',
                severity: url.searchParams.get('severity') || '',
                severityStatus: url.searchParams.get('severityStatus') || '',
                framework: url.searchParams.get('framework') || '',
                owner: url.searchParams.get('owner') || '',
                testMode: url.searchParams.get('testMode') || '',
                automationStatus: url.searchParams.get('automationStatus') || '',
                validationStatus: url.searchParams.get('validationStatus') || '',
                sort: url.searchParams.get('sort') || 'id',
                limit: url.searchParams.get('limit') || 100,
                offset: url.searchParams.get('offset') || 0,
            });
            return json(res, 200, { ...page, items: page.items, entries: page.items, filters: riskKnowledgeFilterOptions(), knowledgeVersion: 'ARL-RKA-1.2.0' }, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
        }
        if (req.method === 'GET' && url.pathname === '/api/risk-knowledge-predicates')
            return json(res, 200, { predicates: architecturePredicateRegistry() }, { 'Cache-Control': 'public, max-age=300' });
        if (req.method === 'POST' && url.pathname === '/api/risk-knowledge/profile') {
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 30, bucket: 'risk-profiler' }))
                return json(res, 429, { error: 'Too many risk-profile requests. Wait a minute and try again.' });
            const body = await readBody(req);
            try {
                return json(res, 200, { results: await profileRiskKnowledge(body.facts || {}) });
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        let riskKnowledgeMatch = url.pathname.match(/^\/api\/risk-knowledge\/([^/]+)\/detail$/);
        if (req.method === 'GET' && riskKnowledgeMatch) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const entry = await getRiskKnowledgeEntry(decodeURIComponent(riskKnowledgeMatch[1]));
            if (!entry) return json(res, 404, { error: 'Risk knowledge entry not found.' });
            return json(res, 200, { entry });
        }
        riskKnowledgeMatch = url.pathname.match(/^\/api\/risk-knowledge\/([^/]+)\/export$/);
        if (req.method === 'GET' && riskKnowledgeMatch) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            try {
                const format = String(url.searchParams.get('format') || 'json').toLowerCase();
                const output = await exportRiskKnowledgeEntry(decodeURIComponent(riskKnowledgeMatch[1]), format);
                const filename = `agentrisklayer-${safeFilename(decodeURIComponent(riskKnowledgeMatch[1]))}-control-manifest.${output.extension}`;
                res.writeHead(200, {
                    'Content-Type': `${output.contentType}; charset=utf-8`,
                    'Content-Disposition': `attachment; filename=\"${filename}\"`,
                    'Content-Length': Buffer.byteLength(output.body),
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                });
                return res.end(output.body);
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        riskKnowledgeMatch = url.pathname.match(/^\/api\/risk-knowledge\/([^/]+)$/);
        if (req.method === 'GET' && riskKnowledgeMatch) {
            const entry = await getPublicRiskKnowledgeEntry(decodeURIComponent(riskKnowledgeMatch[1]));
            if (!entry) return json(res, 404, { error: 'Risk knowledge entry not found.' });
            return json(res, 200, { entry }, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
        }
        if (req.method === 'GET' && url.pathname === '/api/auth/me')
            return json(res, 200, { user: req.user });
        if (req.method === 'POST' && url.pathname === '/api/discovery/analyse') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, discoverAiAssets(body.documents || body));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/models/analyse') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                const bytes = Buffer.from(String(body.base64 || ''), 'base64');
                if (!bytes.length || bytes.length > 10 * 1024 * 1024)
                    throw new Error('Model sample must contain 1 byte to 10 MiB.');
                return json(res, 200, analyseModelArtifact({ name: body.name, bytes, expectedSha256: body.expectedSha256 }));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/register') {
            const body = await readBody(req);
            const emailIdentity = cleanText(body.email, 254).toLowerCase();
            if (!await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 8, bucket: 'register-ip', penaltyMs: 60000 }) ||
                !await rateLimitAllowed(req, { windowMs: 60 * 60000, max: 4, bucket: 'register-account', identity: emailIdentity, penaltyMs: 5 * 60000 })) {
                return json(res, 429, { error: 'Too many registration attempts. Try again later.' });
            }
            try {
                const user = await registerUser(body.email, body.password, body.termsAccepted === true);
                const verification = await createEmailVerification(user.id);
                if (verification)
                    await sendEmailVerification({ userId: user.id, to: user.email, token: verification.token }).catch((error) => console.error('Verification email failed:', error.message));
                await createSession(res, user.id);
                await claimAssessmentForUser(body.claimAssessmentId, body.claimToken, user.id);
                await insertEvent('user_registered', user.id);
                return json(res, 201, {
                    user,
                    verificationRequired: true,
                    demoVerificationUrl: config.demoMode && verification ? `/verify.html?token=${encodeURIComponent(verification.token)}` : null,
                });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/login') {
            const body = await readBody(req);
            const emailIdentity = cleanText(body.email, 254).toLowerCase();
            if (!await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 30, bucket: 'auth-global', penaltyMs: 60000 }) ||
                !await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 8, bucket: 'login-ip', penaltyMs: 60000 }) ||
                !await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 6, bucket: 'login-account', identity: emailIdentity, penaltyMs: 2 * 60000 })) {
                return json(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
            }
            try {
                const user = await authenticateUser(body.email, body.password);
                await clearRateLimit(req, { bucket: 'login-account', identity: emailIdentity });
                if (user.mfaEnabled) {
                    const challenge = await createMfaLoginChallenge(user.id);
                    return json(res, 202, { mfaRequired: true, challengeToken: challenge.challengeToken, expiresAt: challenge.expiresAt });
                }
                await createSession(res, user.id);
                await claimAssessmentForUser(body.claimAssessmentId, body.claimToken, user.id);
                await insertEvent('user_logged_in', user.id);
                return json(res, 200, { user });
            }
            catch (error) {
                return json(res, 401, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/mfa/verify') {
            const body = await readBody(req);
            if (!await rateLimitAllowed(req, { windowMs: 10 * 60000, max: 8, bucket: 'mfa-login', identity: body.challengeToken, penaltyMs: 2 * 60000 })) {
                return json(res, 429, { error: 'Too many authentication-code attempts.' });
            }
            try {
                const userId = await completeMfaLogin(body.challengeToken, body.code);
                await createSession(res, userId, { mfaVerified: true });
                const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
                await insertEvent('user_logged_in_mfa', userId);
                return json(res, 200, { user: { id: user.id, email: user.email, emailVerified: Boolean(user.email_verified_at), mfaEnabled: true } });
            }
            catch (error) {
                return json(res, 401, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
            await clearSession(req, res);
            return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') {
            const body = await readBody(req);
            try {
                const userId = await verifyEmailToken(body.token);
                await insertEvent('email_verified', userId);
                return json(res, 200, { ok: true });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/verification/resend') {
            if (!requireUser(req, res))
                return;
            if (req.user.emailVerified)
                return json(res, 200, { ok: true, alreadyVerified: true });
            if (!await rateLimitAllowed(req, { windowMs: 60 * 60000, max: 3, bucket: 'verification-resend', identity: req.user.email, penaltyMs: 10 * 60000 })) {
                return json(res, 429, { error: 'Too many verification emails requested.' });
            }
            const verification = await createEmailVerification(req.user.id);
            if (verification)
                await sendEmailVerification({ userId: req.user.id, to: req.user.email, token: verification.token });
            return json(res, 200, { ok: true, demoVerificationUrl: config.demoMode && verification ? `/verify.html?token=${encodeURIComponent(verification.token)}` : null });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/reauth') {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { user: await reauthenticateSession(req, body.password, body.code) });
            }
            catch (error) {
                return json(res, 401, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
            const body = await readBody(req);
            if (!await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 5, bucket: 'password-reset-request', identity: body.email, penaltyMs: 5 * 60000 })) {
                return json(res, 429, { error: 'Too many reset requests. Try again later.' });
            }
            const reset = await createPasswordReset(body.email);
            let demoResetUrl = null;
            if (reset) {
                await sendPasswordResetEmail({ userId: reset.user.id, to: reset.user.email, token: reset.token }).catch((error) => console.error('Password reset email failed:', error.message));
                await insertEvent('password_reset_requested', reset.user.id);
                if (config.demoMode)
                    demoResetUrl = `/reset.html?token=${encodeURIComponent(reset.token)}`;
            }
            return json(res, 200, { ok: true, message: 'If the account exists, a reset link has been sent.', demoResetUrl });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/password-reset/confirm') {
            const body = await readBody(req);
            if (!await rateLimitAllowed(req, { windowMs: 15 * 60000, max: 10, bucket: 'password-reset-confirm', identity: body.token, penaltyMs: 5 * 60000 })) {
                return json(res, 429, { error: 'Too many reset attempts. Try again later.' });
            }
            try {
                const userId = await resetPassword(body.token, body.password);
                const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
                await sendPasswordChangedEmail({ userId, to: user.email }).catch((error) => console.error('Password changed email failed:', error.message));
                await insertEvent('password_reset_completed', userId);
                return json(res, 200, { ok: true });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/assessments') {
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 20, bucket: 'assessment' }))
                return json(res, 429, { error: 'Too many assessments submitted.' });
            const body = await readBody(req);
            try {
                const name = cleanText(body.name, 100);
                const agentType = cleanText(body.agentType, 80);
                if (name.length < 2)
                    throw new Error('Enter a name for the agent or system.');
                if (agentType.length < 2)
                    throw new Error('Choose an agent type.');
                const sourceAssessmentId = cleanText(body.sourceAssessmentId || '', 80);
                let sourceAssessment = null;
                if (sourceAssessmentId) {
                    sourceAssessment = await db.prepare('SELECT id,user_id,access_token FROM assessments WHERE id = ?').get(sourceAssessmentId);
                    if (!sourceAssessment)
                        throw Object.assign(new Error('Source assessment not found.'), { statusCode: 404 });
                    const sourceOwned = Boolean(req.user && sourceAssessment.user_id === req.user.id);
                    const unclaimedWithToken = Boolean(!sourceAssessment.user_id && body.sourceAccessToken && constantTimeTextEqual(String(body.sourceAccessToken), sourceAssessment.access_token));
                    if (!sourceOwned && !unclaimedWithToken)
                        throw Object.assign(new Error('You do not have permission to create an update from this assessment.'), { statusCode: 403 });
                }
                const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? { ...body.answers } : {};
                delete answers.__source_assessment_id;
                if (sourceAssessment) answers.__source_assessment_id = sourceAssessment.id;
                const result = evaluateAssessment(answers, { agentType, sourceAssessmentId: sourceAssessment?.id || null });
                const assessmentId = id('asm_');
                const accessToken = id('access_');
                const shareToken = id('share_');
                const created = nowIso();
                await db.prepare(`
          INSERT INTO assessments
          (id, user_id, name, agent_type, answers_json, score, risk_band, result_json, paid_tier, access_token, share_token, public_enabled, scoring_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, 0, ?, ?, ?)
        `).run(assessmentId, req.user?.id || null, name, agentType, JSON.stringify(answers), result.score, result.riskBand, JSON.stringify(result), accessToken, shareToken, config.scoringVersion, created, created);
                await insertEvent('assessment_completed', req.user?.id || null, { assessmentId, sourceAssessmentId: sourceAssessment?.id || null, score: result.score, riskBand: result.riskBand, agentType });
                return json(res, 201, {
                    assessment: publicAssessment({ id: assessmentId, name, agent_type: agentType, score: result.score, risk_band: result.riskBand, result_json: JSON.stringify(result), paid_tier: 'free', access_token: accessToken, share_token: shareToken, public_enabled: 0, scoring_version: config.scoringVersion, created_at: created }),
                    accessToken,
                });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        let match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            const row = await db.prepare('SELECT * FROM assessments WHERE id = ?').get(decodeURIComponent(match[1]));
            if (!row)
                return json(res, 404, { error: 'Assessment not found.' });
            const hasToken = url.searchParams.get('token') === row.access_token;
            const isOwner = Boolean(req.user && row.user_id === req.user.id);
            if (!hasToken && !isOwner)
                return json(res, 403, { error: 'This assessment is private.' });
            const superuserAccess = Boolean(isOwner && req.user?.isSuperuser);
            const effectiveTier = superuserAccess ? 'pro' : row.paid_tier;
            const inspection = isOwner ? await latestInspection(row.id) : null;
            const redTeamRun = isOwner ? await latestRedTeamRun(row.id) : null;
            const canRevise = Boolean(isOwner || (!row.user_id && hasToken));
            const revisionSource = canRevise ? {
                assessmentId: row.id,
                name: row.name,
                agentType: row.agent_type,
                answers: parseJson(row.answers_json, {}),
                scoringVersion: row.scoring_version,
                createdAt: row.created_at,
            } : null;
            return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier, inspection, redTeamRun), canDownload: effectiveTier !== 'free', isOwner, superuserAccess, revisionSource, inspection, redTeamRun });
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/claim$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            const claimed = await claimAssessmentForUser(decodeURIComponent(match[1]), body.token, req.user.id);
            return claimed ? json(res, 200, { ok: true }) : json(res, 400, { error: 'The assessment could not be claimed.' });
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/sharing$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            const assessmentId = decodeURIComponent(match[1]);
            const row = await db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, req.user.id);
            if (!row)
                return json(res, 404, { error: 'Assessment not found.' });
            const enabled = body.enabled === true ? 1 : 0;
            await db.prepare('UPDATE assessments SET public_enabled = ?, updated_at = ? WHERE id = ?').run(enabled, nowIso(), assessmentId);
            await insertEvent(enabled ? 'sharing_enabled' : 'sharing_disabled', req.user.id, { assessmentId });
            return json(res, 200, { publicEnabled: Boolean(enabled) });
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)$/);
        if (req.method === 'DELETE' && match) {
            if (!requireUser(req, res))
                return;
            const assessmentId = decodeURIComponent(match[1]);
            const row = await db.prepare('SELECT id FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, req.user.id);
            if (!row)
                return json(res, 404, { error: 'Assessment not found.' });
            await db.prepare('DELETE FROM assessments WHERE id = ?').run(assessmentId);
            await insertEvent('assessment_deleted', req.user.id, { assessmentId });
            return json(res, 200, { ok: true });
        }
        match = url.pathname.match(/^\/api\/public\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            const row = await db.prepare('SELECT * FROM assessments WHERE share_token = ? AND public_enabled = 1').get(decodeURIComponent(match[1]));
            return row ? json(res, 200, { assessment: publicAssessment(row) }) : json(res, 404, { error: 'This shared assessment is unavailable.' });
        }
        match = url.pathname.match(/^\/badge\/([^/]+)\.svg$/);
        if (req.method === 'GET' && match)
            return await serveBadge(res, decodeURIComponent(match[1]));
        if (req.method === 'POST' && url.pathname === '/api/inspector/github') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 4, bucket: 'github-source-inspection', identity: req.user.id }))
                return json(res, 429, { error: 'Too many hosted source-inspection requests. Wait a minute and try again.' });
            const body = await readBody(req);
            try {
                const result = await runFrozenGithubSourceInspection({
                    userId: req.user.id,
                    assessmentId: cleanText(body.assessmentId, 80),
                });
                return json(res, 201, result);
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/inspector/tokens') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 10, bucket: 'inspection-token', identity: req.user.id }))
                return json(res, 429, { error: 'Too many inspection token requests.' });
            const body = await readBody(req);
            try {
                return json(res, 201, await createInspectionToken({ userId: req.user.id, assessmentId: cleanText(body.assessmentId, 80) }));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/inspections$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { inspections: await listInspectionsForAssessment({ assessmentId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, 404, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/inspections\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            const inspection = await getInspection({ inspectionId: decodeURIComponent(match[1]), userId: req.user.id });
            return inspection ? json(res, 200, { inspection }) : json(res, 404, { error: 'Inspection not found.' });
        }
        if (req.method === 'POST' && url.pathname === '/api/redteam/authorisations') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 8, bucket: 'redteam-authorisation', identity: req.user.id }))
                return json(res, 429, { error: 'Too many authorisation requests.' });
            const body = await readBody(req);
            try {
                return json(res, 201, { authorisation: await createRedTeamAuthorisation({ userId: req.user.id, assessmentId: cleanText(body.assessmentId, 80), input: body }) });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/redteam\/authorisations$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { authorisations: await listRedTeamAuthorisations({ assessmentId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, 404, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/redteam\/authorisations\/([^/]+)\/revoke$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, await revokeRedTeamAuthorisation({ authorisationId: decodeURIComponent(match[1]), userId: req.user.id }));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/redteam/recovery-tokens') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 6, bucket: 'redteam-recovery-token', identity: req.user.id }))
                return json(res, 429, { error: 'Too many red-team recovery requests.' });
            try {
                const body = await readBody(req, 2 * 1024 * 1024);
                return json(res, 201, await createRedTeamRecoveryToken({ userId: req.user.id, assessmentId: cleanText(body.assessmentId, 80), bundle: body.bundle }));
            }
            catch (error) {
                const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
                return json(res, status, { error: error.code === 'BODY_TOO_LARGE' ? 'Evidence bundle exceeds 2 MB.' : error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/redteam/tokens') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 10, bucket: 'redteam-token', identity: req.user.id }))
                return json(res, 429, { error: 'Too many red-team token requests.' });
            const body = await readBody(req);
            try {
                return json(res, 201, await createRedTeamToken({ userId: req.user.id, assessmentId: cleanText(body.assessmentId, 80), mode: cleanText(body.mode || 'simulation', 20), authorisationId: cleanText(body.authorisationId || '', 80) || null }));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/assessments\/([^/]+)\/redteam$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { runs: await listRedTeamRunsForAssessment({ assessmentId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, 404, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/redteam\/runs\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            const run = await getRedTeamRun({ runId: decodeURIComponent(match[1]), userId: req.user.id });
            return run ? json(res, 200, { run }) : json(res, 404, { error: 'Red-team run not found.' });
        }
        match = url.pathname.match(/^\/api\/reports\/([^/]+)\/pdf$/);
        if (req.method === 'GET' && match)
            return await downloadReport(req, res, decodeURIComponent(match[1]), url.searchParams.get('token'));
        if (req.method === 'GET' && url.pathname === '/api/account/export') {
            if (!requireUser(req, res))
                return;
            return await exportAccount(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/account/mfa/setup') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, await beginMfaSetup(req.user.id, body.password));
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/account/mfa/enable') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                const result = await enableMfa(req.user.id, body);
                await insertEvent('mfa_enabled', req.user.id);
                return json(res, 200, result);
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/account/mfa/disable') {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            try {
                await disableMfa(req.user.id, body);
                await insertEvent('mfa_disabled', req.user.id);
                return json(res, 200, { ok: true });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/account/password') {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            try {
                await changePassword(req.user.id, body.currentPassword, body.newPassword);
                await createSession(res, req.user.id, { mfaVerified: req.user.mfaVerified });
                await sendPasswordChangedEmail({ userId: req.user.id, to: req.user.email }).catch((error) => console.error('Password changed email failed:', error.message));
                await insertEvent('password_changed', req.user.id);
                return json(res, 200, { ok: true });
            }
            catch (error) {
                return json(res, 400, { error: error.message });
            }
        }
        if (req.method === 'POST' && url.pathname === '/api/account/delete') {
            if (!requireUser(req, res))
                return;
            const body = await readBody(req);
            return await deleteAccount(req, res, body);
        }
        if (req.method === 'GET' && url.pathname === '/api/dashboard') {
            if (!requireUser(req, res))
                return;
            return await dashboard(req, res);
        }
        if (req.method === 'GET' && url.pathname === '/api/workspaces') {
            if (!requireUser(req, res))
                return;
            return json(res, 200, { workspaces: await listWorkspaces(req.user.id) });
        }
        if (req.method === 'POST' && url.pathname === '/api/workspaces') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { workspace: await createWorkspace(req.user.id, body.name) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { workspace: await getWorkspace(decodeURIComponent(match[1]), req.user.id) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { workspace: await upsertMember({ workspaceId: decodeURIComponent(match[1]), actorId: req.user.id, ...body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/scim-token$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            try {
                return json(res, 201, { token: await createScimToken(decodeURIComponent(match[1]), req.user.id), shownOnce: true });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/integrations$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { integration: await configureIntegration({ workspaceId: decodeURIComponent(match[1]), actorId: req.user.id, ...body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        match = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/events$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { deliveries: await deliverSecurityEvent({ workspaceId: decodeURIComponent(match[1]), actorId: req.user.id, event: body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message });
            }
        }
        if (req.method === 'GET' && url.pathname === '/api/control-plane/overview') {
            if (!requireUser(req, res))
                return;
            return json(res, 200, await controlPlaneOverview(req.user.id));
        }
        if (req.method === 'POST' && url.pathname === '/api/projects') {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                let workspaceId = cleanText(body.workspaceId, 100);
                if (!workspaceId) {
                    const workspaces = await listWorkspaces(req.user.id);
                    workspaceId = workspaces[0]?.id || (await createWorkspace(req.user.id, `${req.user.email.split('@')[0]}'s security workspace`)).id;
                }
                return json(res, 201, { project: await createSecurityProject({ userId: req.user.id, workspaceId, name: body.name, environment: body.environment, projectKind: body.projectKind }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { project: await getSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'PATCH' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { project: await updateSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id, patch: body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-knowledge-readiness$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            try {
                const project = await getSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id });
                return json(res, 200, await getProjectEvidenceReadiness({ workspaceId: project.workspaceId, projectId: project.id }));
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            try {
                return json(res, 200, await getControlIntelligence({ projectId: decodeURIComponent(match[1]), userId: req.user.id,
                    limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset'), status: url.searchParams.get('status') || '' }), { 'Cache-Control': 'private, no-store' });
            } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            try {
                return json(res, 201, await createSystemSnapshot({ projectId: decodeURIComponent(match[1]), userId: req.user.id, input: body }), { 'Cache-Control': 'private, no-store' });
            } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/report$/);
        if(req.method==='GET'&&match){if(!requireUser(req,res)||!requireVerifiedEmail(req,res))return;try{const project=await getSecurityProject({projectId:decodeURIComponent(match[1]),userId:req.user.id});return json(res,200,{report:await getControlIntelligenceReportSummary({projectId:project.id})},{'Cache-Control':'private, no-store'});}catch(error){return json(res,error.statusCode||400,{error:error.message},{'Cache-Control':'private, no-store'});}}
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            try {
                return json(res, 200, await getControlIntelligenceControl({ projectId: decodeURIComponent(match[1]), controlId: decodeURIComponent(match[2]), userId: req.user.id,
                    historyLimit: url.searchParams.get('limit') }), { 'Cache-Control': 'private, no-store' });
            } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)\/applicability$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body=await readBody(req);
            try { return json(res,200,await assessControlApplicability({projectId:decodeURIComponent(match[1]),controlId:decodeURIComponent(match[2]),userId:req.user.id,input:body}),{'Cache-Control':'private, no-store'}); }
            catch(error){ return json(res,error.statusCode||400,{error:error.message,code:error.code||undefined},{'Cache-Control':'private, no-store'}); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/applicability\/batch$/);
        if(req.method==='POST'&&match){if(!requireUser(req,res)||!requireVerifiedEmail(req,res))return;const body=await readBody(req);try{return json(res,200,await assessControlApplicabilityBatch({projectId:decodeURIComponent(match[1]),userId:req.user.id,input:body}),{'Cache-Control':'private, no-store'});}catch(error){return json(res,error.statusCode||400,{error:error.message,code:error.code||undefined},{'Cache-Control':'private, no-store'});}}
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)\/tests$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const field of ['workspaceId','userId','contentDigest','checkDigest','chainStatus','severity','severityStatus']) if (Object.hasOwn(body, field)) return json(res, 400, { error: `Caller-supplied ${field} is not accepted.` });
            try { return json(res, 201, { execution: await recordControlTestExecution({ projectId: decodeURIComponent(match[1]), controlId: decodeURIComponent(match[2]), userId: req.user.id, input: body }) }); }
            catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)\/evidence$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const field of ['workspaceId','userId','integrityDigest','verificationState','chainStatus','severity','severityStatus']) if (Object.hasOwn(body, field)) return json(res, 400, { error: `Caller-supplied ${field} is not accepted.` });
            try { return json(res, 201, { evidence: await recordControlEvidence({ projectId: decodeURIComponent(match[1]), controlId: decodeURIComponent(match[2]), userId: req.user.id, input: body }) }); }
            catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)\/findings$/);
        if(req.method==='POST'&&match){if(!requireUser(req,res)||!requireVerifiedEmail(req,res))return;const body=await readBody(req);for(const field of ['severity','creatorId','workspaceId','projectId','controlDigest','profileVersion','createdAt','integrityDigest','deploymentImpact'])if(Object.hasOwn(body,field))return json(res,400,{error:`Caller-supplied ${field} is not accepted.`});try{return json(res,201,{finding:await createControlFinding({projectId:decodeURIComponent(match[1]),controlId:decodeURIComponent(match[2]),userId:req.user.id,input:body})},{'Cache-Control':'private, no-store'});}catch(error){return json(res,error.statusCode||400,{error:error.message,code:error.code||undefined},{'Cache-Control':'private, no-store'});}}
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/deployment-decisions$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const field of ['workspaceId','userId','decision','decisionDigest','summary','criticalBlockers','deploymentGate']) if (Object.hasOwn(body, field)) return json(res, 400, { error: `Caller-supplied ${field} is not accepted.` });
            try { return json(res, 201, { deploymentDecision: await recordDeploymentDecision({ projectId: decodeURIComponent(match[1]), userId: req.user.id, input: body }) }); }
            catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/control-intelligence\/controls\/([^/]+)\/findings\/([^/]+)\/closure$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body=await readBody(req);
            for(const field of ['reviewerId','reviewerRole','reviewedAt','closureDigest','status','severity'])if(Object.hasOwn(body,field))return json(res,400,{error:`Caller-supplied ${field} is not accepted.`});
            try{return json(res,200,{finding:await closeControlFinding({projectId:decodeURIComponent(match[1]),controlId:decodeURIComponent(match[2]),findingId:decodeURIComponent(match[3]),userId:req.user.id,input:body})},{'Cache-Control':'private, no-store'});}
            catch(error){return json(res,error.statusCode||400,{error:error.message,code:error.code||undefined},{'Cache-Control':'private, no-store'});}
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-knowledge-profile$/);
        if (req.method === 'PUT' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const forbiddenField of ['workspaceId','userId','deploymentGate','criticalGateFailed','evidenceCount','manualApplicability','severity','severityStatus','evaluatedSeverity','projectSeverity']) {
                if (Object.hasOwn(body, forbiddenField)) return json(res, 400, { error: `Caller-supplied ${forbiddenField} is not accepted.` });
            }
            try {
                const project = await getSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id });
                if (!['developer','admin','owner'].includes(project.role)) return json(res, 403, { error: 'Project developer, admin or owner access is required.' });
                return json(res, 200, await applyProjectRiskKnowledgeProfile({ workspaceId: project.workspaceId, projectId: project.id, architectureFacts: body.facts || {}, userId: req.user.id }));
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-knowledge-links$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const forbiddenField of ['workspaceId','userId']) {
                if (Object.hasOwn(body, forbiddenField)) return json(res, 400, { error: `Caller-supplied ${forbiddenField} is not accepted.` });
            }
            try {
                const project = await getSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id });
                if (!['admin','owner'].includes(project.role)) return json(res, 403, { error: 'Project admin or owner access is required.' });
                const link = await linkRiskKnowledge({
                    workspaceId: project.workspaceId,
                    projectId: project.id,
                    subjectType: String(body.subjectType || ''),
                    subjectId: String(body.subjectId || ''),
                    entryId: String(body.entryId || ''),
                    linkRole: String(body.linkRole || 'primary'),
                    userId: req.user.id,
                    subjectResolver: resolveRiskKnowledgeSubject,
                });
                return json(res, link.duplicate ? 200 : 201, { link });
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-knowledge\/([^/]+)\/state$/);
        if (req.method === 'PUT' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res)) return;
            const body = await readBody(req);
            for (const forbiddenField of ['workspaceId','userId','deploymentGate','criticalGateFailed','evidenceCount','manualApplicability','severity','severityStatus','evaluatedSeverity','projectSeverity']) {
                if (Object.hasOwn(body, forbiddenField)) return json(res, 400, { error: `Caller-supplied ${forbiddenField} is not accepted.` });
            }
            try {
                const project = await getSecurityProject({ projectId: decodeURIComponent(match[1]), userId: req.user.id });
                if (!['admin','owner'].includes(project.role)) return json(res, 403, { error: 'Project admin or owner access is required.' });
                const state = await setProjectRiskKnowledgeState({
                    workspaceId: project.workspaceId,
                    projectId: project.id,
                    entryId: decodeURIComponent(match[2]),
                    architectureFacts: Object.hasOwn(body, 'architectureFacts') ? body.architectureFacts : null,
                    evidenceState: body.evidenceState || 'not_assessed',
                    stateReason: body.stateReason || '',
                    userId: req.user.id,
                });
                return json(res, 200, { state });
            } catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/keys$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { keys: await listProjectApiKeys({ projectId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { key: await createProjectApiKey({ projectId: decodeURIComponent(match[1]), userId: req.user.id, name: body.name, expiresAt: body.expiresAt }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/revoke$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            try {
                return json(res, 200, await revokeProjectApiKey({ projectId: decodeURIComponent(match[1]), keyId: decodeURIComponent(match[2]), userId: req.user.id }));
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/guided-protection-check$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const projectId = decodeURIComponent(match[1]);
            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 5, bucket: 'guided-protection-check', identity: `${req.user.id}:${projectId}` }))
                return json(res, 429, { error: 'Too many guided checks. Wait a minute and try again.' });
            try {
                return json(res, 200, { check: await runGuidedProtectionCheck({ projectId, userId: req.user.id }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/approvals$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { approvals: await listRuntimeApprovals({ projectId: decodeURIComponent(match[1]), userId: req.user.id, limit: url.searchParams.get('limit') }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            for (const field of ['approvalDigest','actionDigest','requirementDigest','workspaceId','userId']) if (Object.hasOwn(body,field)) return json(res,400,{error:`Caller-supplied ${field} is not accepted.`});
            try {
                return json(res, 201, { approval: await createRuntimeApproval({
                    projectId: decodeURIComponent(match[1]),
                    userId: req.user.id,
                    toolCall: body.toolCall || body.tool_call,
                    ttlSeconds: body.ttlSeconds || body.ttl_seconds,
                    controlId: body.controlId,
                    systemSnapshotId: body.systemSnapshotId,
                }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/approvals\/([^/]+)\/revoke$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            try {
                return json(res, 200, await revokeRuntimeApproval({
                    projectId: decodeURIComponent(match[1]),
                    approvalId: decodeURIComponent(match[2]),
                    userId: req.user.id,
                }));
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/events$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { events: await listRuntimeEvents({ projectId: decodeURIComponent(match[1]), userId: req.user.id, limit: url.searchParams.get('limit'), decision: url.searchParams.get('decision') }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/inventory$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { snapshots: await listAssetSnapshots({ projectId: decodeURIComponent(match[1]), userId: req.user.id, limit: url.searchParams.get('limit') }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { snapshot: await recordAssetSnapshot({ projectId: decodeURIComponent(match[1]), userId: req.user.id, documents: body.documents || body, source: body.source || 'manual' }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations$/);
        if (req.method === 'GET' && match) {
            if (!requireUser(req, res))
                return;
            try {
                return json(res, 200, { remediations: await listRemediationItems({ projectId: decodeURIComponent(match[1]), userId: req.user.id }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { remediation: await createRemediationItem({ projectId: decodeURIComponent(match[1]), userId: req.user.id, input: body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations\/([^/]+)$/);
        if (req.method === 'PATCH' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { remediation: await updateRemediationItem({ projectId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]), userId: req.user.id, patch: body }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations\/([^/]+)\/evidence$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 201, { artifact: await registerRemediationEvidenceArtifact({
                    projectId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]), userId: req.user.id,
                    artifactType: cleanText(body.artifactType, 30), sourceType: cleanText(body.sourceType, 40), sourceId: cleanText(body.sourceId, 100),
                }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        match = url.pathname.match(/^\/api\/projects\/([^/]+)\/remediations\/([^/]+)\/evidence-upgrade$/);
        if (req.method === 'POST' && match) {
            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))
                return;
            const body = await readBody(req);
            try {
                return json(res, 200, { remediation: await beginLegacyRemediationUpgrade({
                    projectId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]), userId: req.user.id, reason: body.reason,
                }) });
            }
            catch (error) {
                return json(res, error.statusCode || 400, { error: error.message, code: error.code || undefined });
            }
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return await adminAnalytics(req, res);
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/readiness') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, launchReadiness());
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/sales/overview') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { overview: await salesOverview() });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/sales/prospects') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { prospects: await listProspects({ stage: url.searchParams.get('stage') || undefined, limit: url.searchParams.get('limit') }) });
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/sales/prospects') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 201, { prospect: await createProspect(req.user.id, await readBody(req)) });
        }
        match = url.pathname.match(/^\/api\/admin\/sales\/prospects\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            const prospect = await getProspect(decodeURIComponent(match[1]));
            return prospect ? json(res, 200, { prospect }) : json(res, 404, { error: 'Prospect not found.' });
        }
        if (req.method === 'PATCH' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { prospect: await updateProspect(req.user.id, decodeURIComponent(match[1]), await readBody(req)) });
        }
        match = url.pathname.match(/^\/api\/admin\/sales\/prospects\/([^/]+)\/messages$/);
        if (req.method === 'POST' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 201, { message: await createMessage(req.user.id, decodeURIComponent(match[1]), await readBody(req)) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/sales/messages') {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { messages: await listMessages(url.searchParams.get('prospectId') || null) });
        }
        match = url.pathname.match(/^\/api\/admin\/sales\/messages\/([^/]+)$/);
        if (req.method === 'PATCH' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { message: await updateMessage(req.user.id, decodeURIComponent(match[1]), await readBody(req)) });
        }
        match = url.pathname.match(/^\/api\/admin\/sales\/prospects\/([^/]+)\/activities$/);
        if (req.method === 'POST' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 201, { activity: await recordActivity(req.user.id, decodeURIComponent(match[1]), await readBody(req)) });
        }
        match = url.pathname.match(/^\/api\/admin\/sales\/prospects\/([^/]+)\/demo-brief$/);
        if (req.method === 'GET' && match) {
            if (!requireAdmin(req, res, { requireMfa: true }))
                return;
            return json(res, 200, { brief: buildDemoBrief(await getProspect(decodeURIComponent(match[1]))) });
        }
        if (req.method === 'GET' && url.pathname === '/robots.txt')
            return text(res, 200, renderRobots());
        if (req.method === 'GET' && url.pathname === '/sitemap.xml')
            return xml(res, 200, renderSitemap());
        if (req.method === 'GET' && url.pathname === '/.well-known/security.txt')
            return text(res, 200, renderSecurityTxt());
        match = url.pathname.match(/^\/checks\/([^/]+)$/);
        if (req.method === 'GET' && match) {
            const slug = decodeURIComponent(match[1]);
            const page = seoPages[slug];
            if (page) {
                if (slug === 'mcp-server-risk-assessment') {
                    const { renderMcpServerRiskAssessmentPage } = await import('./src/mcp-seo-page.js');
                    return html(res, 200, renderMcpServerRiskAssessmentPage(config.baseUrl));
                }
                return html(res, 200, renderSeoPage(page));
            }
        }
        if (req.method === 'GET' || req.method === 'HEAD')
            return serveStatic(url.pathname, req, res);
        return json(res, 404, { error: 'Not found.' });
    }
    catch (error) {
        console.error(error);
        if (!res.headersSent) {
            const status = error.statusCode || (error.code === 'BODY_TOO_LARGE' ? 413 : error.code === 'INVALID_JSON' ? 400 : 500);
            const message = error.code === 'BODY_TOO_LARGE' ? 'Request body is too large.' : error.code === 'INVALID_JSON' ? 'Request body contains invalid JSON.' : 'Unexpected server error.';
            return json(res, status, { error: message });
        }
        res.end();
    }
});
async function handleProjectGuard(req, res) {
    const authorization = String(req.headers.authorization || '');
    const rawToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!rawToken)
        return json(res, 401, { error: 'Bearer project API key required.', code: 'invalid_api_key' });
    if (!/^arl_live_[a-f0-9]{10}_[A-Za-z0-9_-]{32,}$/.test(rawToken))
        return json(res, 401, { error: 'Invalid project API key.', code: 'invalid_api_key' });
    try {
        if (!await rateLimitAllowed(req, { windowMs: 60000, max: 30000, bucket: 'guard-auth', penaltyMs: 1000 })) {
            res.setHeader('Retry-After', '60');
            return json(res, 429, { error: 'Runtime authentication rate limit reached. Retry after the rate-limit window.', code: 'rate_limit' });
        }
        const authenticated = await authenticateProjectApiKey(rawToken);
        const entitlement = await entitlementForUser(authenticated.project.billing_user_id);
        if (!await rateLimitAllowed(req, { windowMs: 60000, max: entitlement.runtimeRequestsPerMinute, bucket: 'guard-key', identity: authenticated.apiKeyId, penaltyMs: 1000 })) {
            res.setHeader('Retry-After', '60');
            return json(res, 429, { error: 'Runtime screening burst allowance reached. Retry after the rate-limit window.', code: 'rate_limit' });
        }
        const body = await readBody(req, 1048576);
        const response = await screenGuardRequest({ rawToken, body, authenticated });
        res.setHeader('X-AgentRisk-Decision', response.decision);
        res.setHeader('X-AgentRisk-Request-Id', response.requestId);
        return json(res, 200, response);
    }
    catch (error) {
        return json(res, error.statusCode || 400, { error: error.message, code: error.code || 'guard_error' });
    }
}
async function handleMetrics(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!config.metricsToken || !constantTimeTextEqual(token, config.metricsToken))
        return text(res, 401, 'Unauthorised\n');
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const values = {
        agentrisk_up: 1,
        agentrisk_users_total: Number((await db.prepare('SELECT COUNT(*) count FROM users').get()).count || 0),
        agentrisk_projects_total: Number((await db.prepare(`SELECT COUNT(*) count FROM security_projects WHERE status!='archived'`).get()).count || 0),
        agentrisk_runtime_requests_month: Number((await db.prepare('SELECT COUNT(*) count FROM runtime_events WHERE created_at>=?').get(month)).count || 0),
        agentrisk_runtime_denied_month: Number((await db.prepare(`SELECT COUNT(*) count FROM runtime_events WHERE decision='deny' AND created_at>=?`).get(month)).count || 0),
        agentrisk_open_remediations: Number((await db.prepare(`SELECT COUNT(*) count FROM remediation_items WHERE status NOT IN ('verified','closed','verified_closed','accepted_risk')`).get()).count || 0),
        agentrisk_operational_alerts_open: Number((await db.prepare(`SELECT COUNT(*) count FROM operational_alerts WHERE status='open'`).get()).count || 0),
        agentrisk_process_uptime_seconds: Math.floor(process.uptime()),
        agentrisk_process_resident_memory_bytes: process.memoryUsage().rss,
    };
    const body = Object.entries(values).map(([key, value]) => `# TYPE ${key} gauge\n${key} ${Number(value)}`).join('\n') + '\n';
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    return res.end(body);
}
function constantTimeTextEqual(left, right) {
    try {
        const a = Buffer.from(String(left || ''));
        const b = Buffer.from(String(right || ''));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
async function handleScim(req, res, workspaceId, memberId) {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    try {
        await authenticateScim(workspaceId, token);
        if (req.method === 'GET') {
            const workspace = await db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId);
            if (!workspace)
                return json(res, 404, scimError('Workspace not found.', 404));
            const members = (await db.prepare(`SELECT id,external_id,email,display_name,role,status FROM workspace_members
        WHERE workspace_id=? ORDER BY created_at LIMIT 200`).all(workspaceId)).map(scimUser);
            if (memberId) {
                const member = members.find((item) => item.id === memberId || item.externalId === memberId);
                return member ? json(res, 200, member) : json(res, 404, scimError('User not found.', 404));
            }
            return json(res, 200, { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: members.length, startIndex: 1, itemsPerPage: members.length, Resources: members });
        }
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const body = await readBody(req);
            const patch = req.method === 'PATCH' ? await applyScimPatch(memberId, workspaceId, body) : { ...body, ...(memberId ? { id: memberId } : {}) };
            const member = await provisionScimUser(workspaceId, patch);
            await insertEvent('scim_user_provisioned', null, { workspaceId, memberId: member.id, active: member.status === 'active' });
            return json(res, req.method === 'POST' ? 201 : 200, scimUser(member));
        }
        return json(res, 405, scimError('Method not allowed.', 405));
    }
    catch (error) {
        return json(res, error.statusCode || 400, scimError(error.message, error.statusCode || 400));
    }
}
async function applyScimPatch(memberId, workspaceId, input) {
    const row = await db.prepare('SELECT * FROM workspace_members WHERE workspace_id=? AND (id=? OR external_id=?)').get(workspaceId, memberId, memberId);
    if (!row)
        throw Object.assign(new Error('SCIM user not found.'), { statusCode: 404 });
    const output = { id: row.external_id || row.id, externalId: row.external_id || row.id, userName: row.email, displayName: row.display_name, active: row.status === 'active', role: row.role };
    for (const operation of input.Operations || input.operations || []) {
        const op = String(operation.op || '').toLowerCase();
        if (!['add', 'replace', 'remove'].includes(op))
            continue;
        const pathValue = String(operation.path || '').toLowerCase();
        if (!pathValue && operation.value && typeof operation.value === 'object')
            Object.assign(output, operation.value);
        else if (pathValue === 'active')
            output.active = op === 'remove' ? false : operation.value !== false;
        else if (pathValue === 'displayname')
            output.displayName = op === 'remove' ? '' : operation.value;
        else if (pathValue === 'roles' || pathValue === 'role')
            output.role = op === 'remove' ? 'viewer' : (Array.isArray(operation.value) ? operation.value[0]?.value : operation.value);
    }
    return output;
}
function scimUser(member) {
    return { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], id: member.id, externalId: member.external_id || undefined,
        userName: member.email, displayName: member.display_name || member.email, active: member.status === 'active', roles: [{ value: member.role, primary: true }] };
}
function scimError(detail, status) { return { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail, status: String(status) }; }
async function handleInspectionUpload(req, res) {
    if (!await rateLimitAllowed(req, { windowMs: 60000, max: 12, bucket: 'inspection-upload' }))
        return json(res, 429, { error: 'Too many inspection uploads.' });
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    try {
        const raw = await readRawBody(req, 2000000);
        const contentType = String(req.headers['content-type'] || '').split(';')[0];
        if (contentType !== 'application/json')
            return json(res, 415, { error: 'Evidence bundle must be JSON.' });
        const bundle = JSON.parse(raw.toString('utf8'));
        const accepted = await consumeInspectionUpload({ rawToken: token, bundle });
        return json(res, 201, accepted);
    }
    catch (error) {
        const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
        return json(res, status, { error: error.code === 'BODY_TOO_LARGE' ? 'Evidence bundle exceeds 2 MB.' : error.message });
    }
}
async function handleRedTeamUpload(req, res) {
    if (!await rateLimitAllowed(req, { windowMs: 60000, max: 8, bucket: 'redteam-upload' }))
        return json(res, 429, { error: 'Too many red-team uploads.' });
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    try {
        const raw = await readRawBody(req, 2000000);
        const contentType = String(req.headers['content-type'] || '').split(';')[0];
        if (contentType !== 'application/json')
            return json(res, 415, { error: 'Red-team evidence must be JSON.' });
        const bundle = JSON.parse(raw.toString('utf8'));
        const accepted = await consumeRedTeamUpload({ rawToken: token, bundle });
        return json(res, 201, accepted);
    }
    catch (error) {
        const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
        return json(res, status, { error: error.code === 'BODY_TOO_LARGE' ? 'Red-team evidence exceeds 2 MB.' : error.message });
    }
}
async function downloadReport(req, res, assessmentId, token) {
    const row = await db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
    if (!row)
        return json(res, 404, { error: 'Assessment not found.' });
    const hasToken = token === row.access_token;
    const isOwner = Boolean(req.user && row.user_id === req.user.id);
    const effectiveTier = (isOwner && req.user?.isSuperuser) ? 'pro' : row.paid_tier;
    if ((!hasToken && !isOwner) || effectiveTier === 'free')
        return json(res, 403, { error: 'Report access has not been granted for this assessment.' });
    try {
        const { report } = await buildAssessmentReport(row.id, effectiveTier);
        const pdf = await renderReportPdf(report);
        await insertEvent('report_downloaded', req.user?.id || null, { assessmentId: row.id, tier: effectiveTier });
        res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=\"${safeFilename(row.name)}-agent-risk-report.pdf\"`,
            'Content-Length': pdf.length,
            'Cache-Control': 'private, no-store',
        });
        return res.end(pdf);
    }
    catch (error) {
        console.error(error);
        return json(res, 500, { error: 'The PDF could not be generated.' });
    }
}
async function exportAccount(req, res) {
    const user = await db.prepare(`SELECT id,email,email_verified_at,mfa_enabled_at,terms_version,terms_accepted_at,created_at
    FROM users WHERE id=?`).get(req.user.id);
    const assessments = (await db.prepare(`SELECT id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,public_enabled,
    scoring_version,created_at,updated_at FROM assessments WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id)).map((row) => ({ ...row, answers: parseJson(row.answers_json, {}), result: parseJson(row.result_json, {}),
        answers_json: undefined, result_json: undefined, public_enabled: Boolean(row.public_enabled) }));
    const purchases = await db.prepare(`SELECT id,assessment_id,product_key,amount_pence,currency,status,fulfilment_state,
    fulfilment_attempts,fulfilment_error,fulfilled_at,access_granted_at,email_state,email_attempts,email_error,email_sent_at,
    report_digest,created_at,updated_at FROM purchases WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
    const subscriptions = await db.prepare(`SELECT plan_key,status,current_period_end,created_at,updated_at
    FROM subscriptions WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id);
    const inspections = (await db.prepare(`SELECT id,assessment_id,schema_version,scanner_version,policy_version,bundle_digest,
    subject_json,scope_json,summary_json,findings_json,technologies_json,trust_json,delta_json,created_at
    FROM inspections WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id)).map((row) => ({ ...row,
        subject: parseJson(row.subject_json, {}), scope: parseJson(row.scope_json, {}), summary: parseJson(row.summary_json, {}),
        findings: parseJson(row.findings_json, []), technologies: parseJson(row.technologies_json, []), trust: parseJson(row.trust_json, {}),
        delta: parseJson(row.delta_json, {}), subject_json: undefined, scope_json: undefined, summary_json: undefined,
        findings_json: undefined, technologies_json: undefined, trust_json: undefined, delta_json: undefined }));
    const redTeamRuns = (await db.prepare(`SELECT id,assessment_id,authorisation_id,schema_version,runner_version,policy_version,
    bundle_digest,campaign_json,scope_json,summary_json,results_json,trust_json,delta_json,retention_expires_at,created_at
    FROM redteam_runs WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id)).map((row) => ({ ...row,
        campaign: parseJson(row.campaign_json, {}), scope: parseJson(row.scope_json, {}), summary: parseJson(row.summary_json, {}),
        results: parseJson(row.results_json, []), trust: parseJson(row.trust_json, {}), delta: parseJson(row.delta_json, {}),
        campaign_json: undefined, scope_json: undefined, summary_json: undefined, results_json: undefined,
        trust_json: undefined, delta_json: undefined }));
    const redTeamAuthorisations = (await db.prepare(`SELECT id,assessment_id,target_name,endpoint_origin,environment,authority_basis,
    authorised_by,authorised_role,emergency_contact,window_start,window_end,permitted_actions_json,prohibited_actions_json,
    data_classification,retention_days,legal_hold,status,accepted_at,revoked_at,created_at
    FROM redteam_authorisations WHERE user_id=? ORDER BY created_at DESC`).all(req.user.id)).map((row) => ({ ...row,
        permittedActions: parseJson(row.permitted_actions_json, []), prohibitedActions: parseJson(row.prohibited_actions_json, []),
        legalHold: Boolean(row.legal_hold), permitted_actions_json: undefined, prohibited_actions_json: undefined }));
    const purgeReceipts = (await db.prepare(`SELECT id,assessment_id,authorisation_id,evidence_type,records_deleted,digests_json,
    reason,retention_deadline,executed_at FROM data_purge_receipts WHERE user_id=? ORDER BY executed_at DESC`).all(req.user.id)).map((row) => ({ ...row, digests: parseJson(row.digests_json, []), digests_json: undefined }));
    const projects = await listSecurityProjectsForExport(req.user.id);
    const payload = JSON.stringify({ exportedAt: nowIso(), service: config.companyName, version: config.appVersion,
        user: { ...user, emailVerified: Boolean(user.email_verified_at), mfaEnabled: Boolean(user.mfa_enabled_at) },
        assessments, purchases, subscriptions, inspections, redTeamRuns, redTeamAuthorisations, purgeReceipts, projects }, null, 2);
    await insertEvent('account_exported', req.user.id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename=\"agentrisklayer-data-export.json\"',
        'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'private, no-store' });
    return res.end(payload);
}
async function deleteAccount(req, res, body) {
    if (body.confirmation !== 'DELETE')
        return json(res, 400, { error: 'Type DELETE to confirm account deletion.' });
    try {
        await reauthenticateSession(req, body.password, body.code || '');
    }
    catch (error) {
        return json(res, 401, { error: error.message });
    }
    const userId = req.user.id;
    try {
        await db.transaction(async () => {
            const userProjects = await db.prepare(`SELECT id,workspace_id FROM security_projects WHERE billing_user_id=? OR created_by=?`).all(userId, userId);
            for (const project of userProjects) {
                const successor = await db.prepare(`SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id IS NOT NULL AND user_id!=?
                  AND role='owner' AND status='active' ORDER BY created_at ASC LIMIT 1`).get(project.workspace_id, userId);
                if (successor?.user_id) {
                    await db.prepare('UPDATE security_projects SET billing_user_id=?,created_by=?,updated_at=? WHERE id=?').run(successor.user_id, successor.user_id, nowIso(), project.id);
                    await db.prepare('UPDATE project_api_keys SET created_by=? WHERE project_id=? AND created_by=?').run(successor.user_id, project.id, userId);
                    await db.prepare('UPDATE asset_snapshots SET created_by=? WHERE project_id=? AND created_by=?').run(successor.user_id, project.id, userId);
                    await db.prepare('UPDATE remediation_items SET created_by=? WHERE project_id=? AND created_by=?').run(successor.user_id, project.id, userId);
                }
                else {
                    await db.prepare('DELETE FROM security_projects WHERE id=?').run(project.id);
                }
            }
            const ownedWorkspaces = await db.prepare(`SELECT w.id FROM workspaces w
              JOIN workspace_members m ON m.workspace_id=w.id
              WHERE w.created_by=? AND m.user_id=? AND m.role='owner' AND m.status='active'`).all(userId, userId);
            for (const workspace of ownedWorkspaces) {
                const successor = await db.prepare(`SELECT user_id FROM workspace_members
                  WHERE workspace_id=? AND user_id IS NOT NULL AND user_id!=? AND role='owner' AND status='active'
                  ORDER BY created_at ASC LIMIT 1`).get(workspace.id, userId);
                if (successor?.user_id)
                    await db.prepare('UPDATE workspaces SET created_by=?,updated_at=? WHERE id=?').run(successor.user_id, nowIso(), workspace.id);
                else
                    await db.prepare('DELETE FROM workspaces WHERE id=?').run(workspace.id);
            }
            await db.prepare('DELETE FROM workspace_members WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM email_verification_tokens WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM mfa_login_challenges WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM email_log WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM events WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM data_purge_receipts WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM purchases WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM assessments WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(userId);
            await db.prepare('DELETE FROM users WHERE id=?').run(userId);
        });
    }
    catch (error) {
        console.error('Account deletion failed:', error);
        return json(res, 500, { error: 'The account could not be deleted.' });
    }
    await clearSession(req, res);
    return json(res, 200, { ok: true });
}
async function listSecurityProjectsForExport(userId) {
    const projects = await db.prepare(`SELECT DISTINCT p.id,p.workspace_id,p.name,p.slug,p.environment,p.status,p.policy_json,p.policy_version,p.retention_days,p.created_at,p.updated_at
      FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id WHERE m.user_id=? AND m.status='active' ORDER BY p.created_at DESC`).all(userId);
    const output = [];
    for (const project of projects) {
        const events = (await db.prepare(`SELECT request_id,event_type,decision,observed_decision,severity,rule_ids_json,tool_name,evaluation_ms,metadata_json,created_at
          FROM runtime_events WHERE project_id=? ORDER BY created_at DESC LIMIT 1000`).all(project.id)).map((row) => ({ ...row, ruleIds: parseJson(row.rule_ids_json, []), metadata: parseJson(row.metadata_json, {}), rule_ids_json: undefined, metadata_json: undefined }));
        const inventory = (await db.prepare(`SELECT id,source,source_digest,summary_json,assets_json,drift_json,created_at FROM asset_snapshots WHERE project_id=? ORDER BY created_at DESC`).all(project.id))
            .map((row) => ({ id: row.id, source: row.source, sourceDigest: row.source_digest, summary: parseJson(row.summary_json, {}), assets: parseJson(row.assets_json, []), drift: parseJson(row.drift_json, {}), createdAt: row.created_at }));
        const remediations = (await db.prepare(`SELECT id,assessment_id,finding_key,title,severity,status,owner_email,due_at,verification_json,created_at,updated_at FROM remediation_items WHERE project_id=? ORDER BY updated_at DESC`).all(project.id))
            .map((row) => ({ ...row, verification: parseJson(row.verification_json, {}), verification_json: undefined }));
        const runtimeApprovals = await db.prepare(`SELECT id,approver_id,tool_name,environment,action_digest,status,issued_at,expires_at,
          consumed_at,consumed_request_id,runtime_event_id,revoked_at FROM runtime_approvals WHERE project_id=? ORDER BY issued_at DESC`).all(project.id);
        const riskKnowledgeStates = await db.prepare(`SELECT s.entry_id,e.knowledge_version,e.content_digest,e.title,e.category,
          s.applicability_status,s.applicability_reason,s.architecture_facts_digest,s.evidence_state,s.deployment_gate,
          s.critical_gate_failed,s.state_reason,s.last_assessed_at,s.updated_at
          FROM project_risk_knowledge_states s JOIN risk_knowledge_entries e ON e.id=s.entry_id
          WHERE s.project_id=? AND s.workspace_id=? ORDER BY e.category,e.title`).all(project.id, project.workspace_id);
        const riskKnowledgeLinks = await db.prepare(`SELECT subject_type,subject_id,entry_id,link_role,knowledge_version,entry_digest,created_at
          FROM risk_knowledge_links WHERE project_id=? AND workspace_id=? ORDER BY created_at DESC`).all(project.id, project.workspace_id);
        output.push({ ...project, policy: parseJson(project.policy_json, {}), policy_json: undefined, runtimeEvents: events,
          runtimeApprovals, inventory, remediations, riskKnowledge: {
            states: riskKnowledgeStates.map((state) => ({ ...state, critical_gate_failed: Boolean(state.critical_gate_failed) })),
            links: riskKnowledgeLinks,
          } });
    }
    return output;
}
async function dashboard(req, res) {
    const assessments = (await db.prepare(`
    SELECT a.id,a.name,a.agent_type,a.score,a.risk_band,a.paid_tier,a.access_token,a.share_token,a.public_enabled,
      a.scoring_version,a.created_at,
      (SELECT i.summary_json FROM inspections i WHERE i.assessment_id=a.id ORDER BY i.created_at DESC LIMIT 1) latest_inspection_summary,
      (SELECT i.created_at FROM inspections i WHERE i.assessment_id=a.id ORDER BY i.created_at DESC LIMIT 1) latest_inspection_at,
      (SELECT r.summary_json FROM redteam_runs r WHERE r.assessment_id=a.id ORDER BY r.created_at DESC LIMIT 1) latest_redteam_summary,
      (SELECT r.created_at FROM redteam_runs r WHERE r.assessment_id=a.id ORDER BY r.created_at DESC LIMIT 1) latest_redteam_at
    FROM assessments a WHERE a.user_id=? ORDER BY a.created_at DESC`).all(req.user.id)).map((row) => ({ ...row, latest_inspection_summary: parseJson(row.latest_inspection_summary, null),
        latest_redteam_summary: parseJson(row.latest_redteam_summary, null) }));
    const stats = {
        assessments: assessments.length,
        averageScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length) : 0,
        critical: assessments.filter((item) => item.risk_band === 'Critical').length,
        inspections: (await db.prepare('SELECT COUNT(*) count FROM inspections WHERE user_id=?').get(req.user.id)).count,
        redTeamRuns: (await db.prepare('SELECT COUNT(*) count FROM redteam_runs WHERE user_id=?').get(req.user.id)).count,
    };
    return json(res, 200, { user: req.user, assessments, stats,
        retention: await retentionOverview(req.user.id), controlPlane: await controlPlaneOverview(req.user.id) });
}
async function adminAnalytics(req, res) {
    const totals = {
        users: (await db.prepare('SELECT COUNT(*) count FROM users').get()).count,
        verifiedUsers: (await db.prepare('SELECT COUNT(*) count FROM users WHERE email_verified_at IS NOT NULL').get()).count,
        mfaUsers: (await db.prepare('SELECT COUNT(*) count FROM users WHERE mfa_enabled_at IS NOT NULL').get()).count,
        assessments: (await db.prepare('SELECT COUNT(*) count FROM assessments').get()).count,
        inspections: (await db.prepare('SELECT COUNT(*) count FROM inspections').get()).count,
        redTeamRuns: (await db.prepare('SELECT COUNT(*) count FROM redteam_runs').get()).count,
    };
    const funnel = await db.prepare(`SELECT name,COUNT(*) count FROM events GROUP BY name ORDER BY count DESC`).all();
    const recentFailures = await db.prepare(`SELECT to_email,subject,error,created_at FROM email_log WHERE status='failed' ORDER BY created_at DESC LIMIT 10`).all();
    const riskBands = await db.prepare(`SELECT risk_band band,COUNT(*) count FROM assessments GROUP BY risk_band ORDER BY count DESC`).all();
    return json(res, 200, { totals, funnel, recentFailures, riskBands, readiness: launchReadiness(), retention: await retentionOverview() });
}
async function serveBadge(res, shareToken) {
    const row = await db.prepare('SELECT name, score, risk_band FROM assessments WHERE share_token = ? AND public_enabled = 1').get(shareToken);
    if (!row)
        return text(res, 404, 'Not found');
    const label = escapeXml(cleanText(row.name, 40));
    const band = escapeXml(row.risk_band);
    const score = Number(row.score);
    const accent = score >= 75 ? '#ff5964' : score >= 50 ? '#ff9f43' : score >= 25 ? '#ffd166' : '#2dd4a3';
    const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"430\" height=\"88\" role=\"img\" aria-label=\"AgentRiskLayer score ${score} out of 100\"><rect width=\"430\" height=\"88\" rx=\"14\" fill=\"#10141b\"/><rect x=\"0\" y=\"0\" width=\"8\" height=\"88\" rx=\"4\" fill=\"${accent}\"/><text x=\"28\" y=\"32\" fill=\"#eaf2ee\" font-family=\"Arial,sans-serif\" font-size=\"16\" font-weight=\"700\">Assessed by AgentRiskLayer</text><text x=\"28\" y=\"59\" fill=\"#9aa8a1\" font-family=\"Arial,sans-serif\" font-size=\"13\">${label} · ${band} risk</text><text x=\"356\" y=\"54\" fill=\"${accent}\" font-family=\"Arial,sans-serif\" font-size=\"24\" font-weight=\"700\">${score}/100</text></svg>`;
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(svg), 'Cache-Control': 'public, max-age=300' });
    res.end(svg);
}
async function claimAssessmentForUser(assessmentId, token, userId) {
    if (!assessmentId || !token || !userId)
        return false;
    const result = await db.prepare(`UPDATE assessments
      SET user_id = ?, updated_at = ?
      WHERE id = ? AND access_token = ? AND (user_id IS NULL OR user_id = ?)`)
        .run(userId, nowIso(), String(assessmentId), String(token), userId);
    return Number(result?.changes || 0) === 1;
}
function parseResult(row) { return typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json; }
function publicAssessment(row) {
    const result = parseResult(row);
    return { id: row.id, name: row.name, agentType: row.agent_type, score: row.score, riskBand: row.risk_band, paidTier: row.paid_tier, createdAt: row.created_at, shareToken: row.share_token, publicEnabled: Boolean(row.public_enabled), scoringVersion: row.scoring_version || 'arl-risk-v2.0', headline: result.headline, topFindings: result.topFindings, controls: result.controls, methodology: result.methodology };
}
function accessibleAssessment(row, effectiveTier = row.paid_tier, inspection = null, redTeamRun = null) {
    const result = attachRedTeamToResult(attachInspectionToResult(parseResult(row), inspection), redTeamRun);
    const base = { ...publicAssessment(row), paidTier: effectiveTier,
        inspectionSummary: inspection ? { id: inspection.id, createdAt: inspection.createdAt, summary: inspection.summary, trust: inspection.trust, scope: inspection.scope } : null,
        redTeamSummary: redTeamRun ? { id: redTeamRun.id, createdAt: redTeamRun.createdAt, summary: redTeamRun.summary, trust: redTeamRun.trust, scope: redTeamRun.scope } : null };
    if (effectiveTier === 'free')
        return { ...base, result: { score: result.score, riskBand: result.riskBand, headline: result.headline, decision: result.decision, inherentRisk: result.inherentRisk, controlGap: result.controlGap, evidenceConfidence: result.evidenceConfidence, methodology: result.methodology, topFindings: result.topFindings, findings: result.topFindings, controls: result.controls, recommendations: [], attackPaths: [], inspection: result.inspection ? { assurance: result.inspection.assurance, summary: result.inspection.summary, trust: result.inspection.trust, findings: result.inspection.findings.slice(0, 3) } : null, redTeam: result.redTeam ? { id: result.redTeam.id, assurance: result.redTeam.assurance, campaign: result.redTeam.campaign, summary: result.redTeam.summary, trust: result.redTeam.trust, failedResults: result.redTeam.failedResults.slice(0, 3) } : null } };
    return { ...base, result };
}
function requireUser(req, res) {
    if (req.user)
        return true;
    json(res, 401, { error: 'Sign in required.' });
    return false;
}
function requireVerifiedEmail(req, res) {
    if (req.user?.emailVerified)
        return true;
    json(res, 403, { error: 'Verify your email before using this security-sensitive feature.', code: 'EMAIL_VERIFICATION_REQUIRED' });
    return false;
}
function requireAdmin(req, res, { requireMfa = false } = {}) {
    if (!req.user) {
        json(res, 401, { error: 'Sign in required.' });
        return false;
    }
    if (!req.user.isSuperuser) {
        json(res, 403, { error: 'Superuser access required.' });
        return false;
    }
    if (!req.user.emailVerified) {
        json(res, 403, { error: 'Verified admin email required.' });
        return false;
    }
    if (requireMfa && config.nodeEnv === 'production' && (!req.user.mfaEnabled || !req.user.mfaVerified)) {
        json(res, 403, { error: 'Multi-factor authentication is required for administrative access.', code: 'ADMIN_MFA_REQUIRED' });
        return false;
    }
    return true;
}
function parseJson(value, fallback) {
    try {
        return value == null ? fallback : JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
async function readRawBody(req, limit = 100000) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
            const error = new Error('Body too large');
            error.code = 'BODY_TOO_LARGE';
            throw error;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
async function readBody(req, limit = 100000) {
    const raw = await readRawBody(req, limit);
    if (!raw.length)
        return {};
    const contentType = String(req.headers['content-type'] || '').split(';')[0];
    if (contentType === 'application/json') {
        try {
            return JSON.parse(raw.toString('utf8'));
        }
        catch {
            const error = new Error('Invalid JSON body.');
            error.code = 'INVALID_JSON';
            throw error;
        }
    }
    if (contentType === 'application/x-www-form-urlencoded')
        return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    return {};
}
function json(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
    res.end(body);
}
function html(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}
function text(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}
function xml(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}
function serveStatic(pathname, req, res) {
    let requested = pathname === '/' ? '/index.html' : pathname;
    if (!path.extname(requested))
        requested += '.html';
    const candidate = path.resolve(publicDir, `.${decodeURIComponent(requested)}`);
    if (!candidate.startsWith(publicDir + path.sep))
        return text(res, 403, 'Forbidden');
    let stat;
    try {
        stat = fs.statSync(candidate);
    }
    catch {
        const notFound = path.join(publicDir, '404.html');
        const body = fs.readFileSync(notFound);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
        return req.method === 'HEAD' ? res.end() : res.end(body);
    }
    if (!stat.isFile())
        return text(res, 404, 'Not found');
    const body = fs.readFileSync(candidate);
    const type = mimeTypes[path.extname(candidate).toLowerCase()] || 'application/octet-stream';
    const extension = path.extname(candidate).toLowerCase();
    const cache = ['.html', '.js', '.mjs', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache });
    return req.method === 'HEAD' ? res.end() : res.end(body);
}
function safeFilename(value) { return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assessment'; }
function escapeXml(value) { return String(value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]); }
function renderRobots() {
    return `User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /admin.html\nDisallow: /auth.html\nDisallow: /reset.html\nDisallow: /result.html\nDisallow: /assessment.html\nDisallow: /control-plane.html\nDisallow: /control-intelligence.html\nDisallow: /inspector.html\nSitemap: ${config.baseUrl}/sitemap.xml\n`;
}
function renderSitemap() {
    const paths = ['/', '/ai-agent-security-assessment.html', '/pricing.html', '/request-assessment.html', '/sample-report.html', '/trust.html', '/security-center.html', '/methodology.html', '/standards.html', '/help.html', '/company.html', '/status.html', '/legal/privacy.html', '/legal/terms.html', ...Object.keys(seoPages).map((slug) => `/checks/${slug}`)];
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((item) => `<url><loc>${escapeXml(config.baseUrl + item)}</loc></url>`).join('')}</urlset>`;
}
function renderSecurityTxt() {
    const contact = config.supportEmail ? `mailto:${config.supportEmail}` : config.baseUrl;
    return `Contact: ${contact}\nCanonical: ${config.baseUrl}/.well-known/security.txt\nPolicy: ${config.baseUrl}/legal/terms.html\nExpires: ${new Date(Date.now() + 365 * 86400000).toISOString()}\n`;
}
const seoPages = {
    'email-agent-risk-assessment': { title: 'Email Agent Risk Assessment', type: 'Email agent', description: 'Check inbox access, prompt injection, impersonation, credential scope and autonomous sending risk.' },
    'customer-support-agent-security-check': { title: 'Customer Support Agent Security Check', type: 'Customer support agent', description: 'Assess customer-data exposure, account actions, approval boundaries, audit trails and escalation controls.' },
    'mcp-server-risk-assessment': { title: 'MCP Server Risk Assessment', type: 'MCP-enabled agent', description: 'Review tool trust, server permissions, dynamic discovery, secrets, supply-chain exposure and action validation.' },
    'finance-agent-security-checklist': { title: 'Finance Agent Security Checklist', type: 'Finance agent', description: 'Measure transaction controls, reconciliation, approval thresholds, credentials and maximum-loss boundaries.' },
    'ai-assistant-permissions-checker': { title: 'AI Assistant Permissions Checker', type: 'AI assistant', description: 'Identify excessive permissions, shared identities, missing action limits and weak emergency controls.' },
};
function renderSeoPage(page) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} | AgentRiskLayer</title><meta name="description" content="${page.description}"><link rel="stylesheet" href="/marketing.css"></head><body><header class="marketing-header"><a class="brand" href="/">AgentRiskLayer</a><nav class="marketing-nav"><a href="/ai-agent-security-assessment.html">Assessment</a><a href="/pricing.html">Pricing</a><a class="nav-cta" href="/request-assessment.html">Request an Assessment</a></nav></header><main><section class="page-hero narrow"><p class="eyebrow">AI agent security assessment</p><h1>${page.title}</h1><p class="lede">${page.description}</p><div class="actions"><a class="button primary" href="/request-assessment.html">Request an Assessment</a><a class="button secondary" href="/sample-report.html">See an example report</a></div></section></main><footer class="marketing-footer"><div><strong>AgentRiskLayer</strong><span>AI agent security assessment before production.</span></div><nav><a href="/legal/privacy.html">Privacy</a><a href="/legal/terms.html">Terms</a></nav></footer></body></html>`;
}
assertSafeProductionConfig();
const databaseInitialisation = await initialiseDatabase();
await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
await db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(nowIso());
await enforceRetention();
await startRetentionWorker();
server.listen(config.port, config.host, () => {
    const listenerAddress = server.address();
    console.log(JSON.stringify({ event: 'server_started', version: config.appVersion, productStage: config.productStage, baseUrl: config.baseUrl, bindHost: typeof listenerAddress === 'object' && listenerAddress ? listenerAddress.address : config.host, database: databaseInitialisation.adapter, migrations: databaseInitialisation.migrations || null, demoMode: config.demoMode, timestamp: nowIso() }));
});
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: 'server_shutdown_started', signal, timestamp: nowIso() }));
    const forceTimer = setTimeout(() => process.exit(1), 10000);
    forceTimer.unref?.();
    server.close(async () => {
        try { await db.close(); }
        finally { clearTimeout(forceTimer); process.exit(0); }
    });
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => console.error(JSON.stringify({ event: 'unhandled_rejection', error: String(error?.stack || error), timestamp: nowIso() })));
process.on('uncaughtException', (error) => { console.error(JSON.stringify({ event: 'uncaught_exception', error: String(error?.stack || error), timestamp: nowIso() })); void shutdown('uncaughtException'); });
