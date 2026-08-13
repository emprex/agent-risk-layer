from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old, new, 1))


# src/redteam.js — recovery token issuance and execution-window validation.
replace_once(
    'src/redteam.js',
    "export async function createRedTeamToken({ userId, assessmentId, mode = 'simulation', authorisationId = null }) {",
    "export async function createRedTeamToken({ userId, assessmentId, mode = 'simulation', authorisationId = null, recoveryBundle = null }) {",
)

old_stage = """    let authorisation = null;
    if (requestedMode === 'staging') {
        authorisation = await db.prepare(`SELECT * FROM redteam_authorisations WHERE id = ? AND assessment_id = ? AND user_id = ? AND status='active' AND window_end > ?`).get(authorisationId, assessmentId, userId, nowIso());
        if (!authorisation)
            throw new Error('Create an active written Rules of Engagement authorisation before generating a staging campaign.');
        if (Date.parse(authorisation.window_start) > Date.now() + 15 * 60000)
            throw new Error('The authorised testing window has not started yet.');
    }
"""
new_stage = """    let authorisation = null;
    let recoveryValidation = null;
    if (requestedMode === 'staging') {
        if (recoveryBundle) {
            recoveryValidation = validateRedTeamBundle(recoveryBundle);
            if (!recoveryValidation.valid)
                throw new Error(`Red-team recovery bundle rejected: ${recoveryValidation.error}`);
            if (recoveryBundle.campaign?.target?.mode !== 'staging-adapter')
                throw new Error('Only completed adapter evidence can use recovery upload.');
            const bundleAuthorisationId = clean(recoveryBundle.campaign?.authorisationId || '', 80);
            if (!authorisationId || bundleAuthorisationId !== authorisationId)
                throw new Error('Recovery bundle is not bound to the selected Rules of Engagement.');
            authorisation = await db.prepare(`SELECT * FROM redteam_authorisations WHERE id = ? AND assessment_id = ? AND user_id = ?`).get(authorisationId, assessmentId, userId);
            if (!authorisation)
                throw new Error('The Rules of Engagement for this recovery bundle were not found.');
            assertBundleWithinAuthorisation(recoveryBundle, authorisation);
            if (await db.prepare('SELECT 1 AS ok FROM redteam_runs WHERE bundle_digest = ?').get(recoveryValidation.digest))
                throw new Error('This red-team bundle has already been uploaded.');
        }
        else {
            authorisation = await db.prepare(`SELECT * FROM redteam_authorisations WHERE id = ? AND assessment_id = ? AND user_id = ? AND status='active' AND window_end > ?`).get(authorisationId, assessmentId, userId, nowIso());
            if (!authorisation)
                throw new Error('Create an active written Rules of Engagement authorisation before generating a staging campaign.');
            if (Date.parse(authorisation.window_start) > Date.now() + 15 * 60000)
                throw new Error('The authorised testing window has not started yet.');
        }
    }
"""
replace_once('src/redteam.js', old_stage, new_stage)

old_return = "return { token: raw, expiresAt, assessmentId, mode: requestedMode, authorisation: authorisation ? publicAuthorisation(authorisation) : null, entitlement: { source: superuser ? 'superuser' : subscription?.plan_key || 'founding_assessment', limit: superuser ? null : limit, used: superuser || subscription ? recentRuns : assessmentRuns } };"
new_return = "return { token: raw, expiresAt, assessmentId, mode: requestedMode, recovery: Boolean(recoveryBundle), authorisation: authorisation ? publicAuthorisation(authorisation) : null, entitlement: { source: superuser ? 'superuser' : subscription?.plan_key || 'founding_assessment', limit: superuser ? null : limit, used: superuser || subscription ? recentRuns : assessmentRuns } };"
replace_once('src/redteam.js', old_return, new_return)

marker = "export async function consumeRedTeamUpload({ rawToken, bundle }) {"
recovery_wrapper = """export async function createRedTeamRecoveryToken({ userId, assessmentId, bundle }) {
    const authorisationId = clean(bundle?.campaign?.authorisationId || '', 80);
    if (!authorisationId)
        throw new Error('Completed adapter evidence must contain its Rules of Engagement authorisation ID.');
    return await createRedTeamToken({ userId, assessmentId, mode: 'staging', authorisationId, recoveryBundle: bundle });
}
"""
replace_once('src/redteam.js', marker, recovery_wrapper + marker)

old_consume_auth = """        authorisation = await db.prepare(`SELECT * FROM redteam_authorisations WHERE id=? AND user_id=? AND assessment_id=? AND status='active' AND window_end > ?`).get(tokenRow.authorisation_id, tokenRow.user_id, tokenRow.assessment_id, nowIso());
        if (!authorisation)
            throw new Error('The Rules of Engagement are missing, revoked, or expired.');
        if (String(bundle.campaign?.environment || '') !== authorisation.environment)
            throw new Error('Campaign environment does not match the approved Rules of Engagement.');
        if (authorisation.endpoint_origin && String(bundle.campaign?.target?.endpointOrigin || '') !== authorisation.endpoint_origin)
            throw new Error('Campaign endpoint does not match the approved Rules of Engagement.');
        const skewMs = 5 * 60000;
        const startedAt = Date.parse(bundle.campaign?.startedAt);
        const completedAt = Date.parse(bundle.campaign?.completedAt);
        const windowStart = Date.parse(authorisation.window_start);
        const windowEnd = Date.parse(authorisation.window_end);
        if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt)
            throw new Error('Campaign start and completion timestamps are invalid.');
        if (startedAt < windowStart - skewMs || completedAt > windowEnd + skewMs)
            throw new Error('Campaign execution falls outside the authorised Rules of Engagement time window.');
"""
new_consume_auth = """        authorisation = await db.prepare(`SELECT * FROM redteam_authorisations WHERE id=? AND user_id=? AND assessment_id=?`).get(tokenRow.authorisation_id, tokenRow.user_id, tokenRow.assessment_id);
        if (!authorisation)
            throw new Error('The Rules of Engagement are missing.');
        assertBundleWithinAuthorisation(bundle, authorisation);
"""
replace_once('src/redteam.js', old_consume_auth, new_consume_auth)

old_boundary = "        boundary: 'Integrity-verified redacted outcomes from a customer-operated local/test/staging run. AgentRiskLayer did not independently operate the target or retain raw transcripts.',\n"
new_boundary = old_boundary + "        ...(authorisation ? { executionWithinAuthorisedWindow: true, ingestedAfterAuthorisationWindow: Date.now() > Date.parse(authorisation.window_end) } : {}),\n"
replace_once('src/redteam.js', old_boundary, new_boundary)

helper_marker = "export function validateRedTeamBundle(bundle) {"
helper = """function assertBundleWithinAuthorisation(bundle, authorisation) {
    if (String(bundle.campaign?.environment || '') !== authorisation.environment)
        throw new Error('Campaign environment does not match the approved Rules of Engagement.');
    if (authorisation.endpoint_origin && String(bundle.campaign?.target?.endpointOrigin || '') !== authorisation.endpoint_origin)
        throw new Error('Campaign endpoint does not match the approved Rules of Engagement.');
    const skewMs = 5 * 60000;
    const startedAt = Date.parse(bundle.campaign?.startedAt);
    const completedAt = Date.parse(bundle.campaign?.completedAt);
    const windowStart = Date.parse(authorisation.window_start);
    const windowEnd = Date.parse(authorisation.window_end);
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt)
        throw new Error('Campaign start and completion timestamps are invalid.');
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart)
        throw new Error('Rules of Engagement time window is invalid.');
    if (startedAt < windowStart - skewMs || completedAt > windowEnd + skewMs)
        throw new Error('Campaign execution falls outside the authorised Rules of Engagement time window.');
    const revokedAt = Date.parse(authorisation.revoked_at || '');
    if (authorisation.status === 'revoked' && !Number.isFinite(revokedAt))
        throw new Error('Rules of Engagement revocation time is unavailable.');
    if (Number.isFinite(revokedAt) && completedAt > revokedAt + skewMs)
        throw new Error('Campaign execution continued after the Rules of Engagement were revoked.');
    return true;
}
"""
replace_once('src/redteam.js', helper_marker, helper + helper_marker)

# server.js — authenticated, CSRF-protected recovery-token endpoint.
replace_once(
    'server.js',
    "attachRedTeamToResult, consumeRedTeamUpload, createRedTeamAuthorisation, createRedTeamToken, getRedTeamRun",
    "attachRedTeamToResult, consumeRedTeamUpload, createRedTeamAuthorisation, createRedTeamRecoveryToken, createRedTeamToken, getRedTeamRun",
)
token_route = "        if (req.method === 'POST' && url.pathname === '/api/redteam/tokens') {\n"
recovery_route = """        if (req.method === 'POST' && url.pathname === '/api/redteam/recovery-tokens') {
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
"""
replace_once('server.js', token_route, recovery_route + token_route)

# public/redteam.js — self-contained browser recovery, no token copy/paste and no target rerun.
replace_once(
    'public/redteam.js',
    '<div id="commandBox"></div></section><aside',
    '<div id="commandBox"></div><div class="command-card section-gap"><span class="eyebrow">Completed evidence recovery</span><h3>Upload a signed bundle that already finished</h3><p class="microcopy">Use this only when a customer-operated adapter run finished inside its Rules of Engagement window but the upload failed. Recovery verifies the signed bundle and original authorisation; it does not rerun the target or extend the testing window.</p><div class="field"><label for="recoveryBundle">Signed Red Team bundle</label><input id="recoveryBundle" type="file" accept=".json,application/json"></div><button class="button ghost" id="recoverBundle">Upload completed signed bundle</button><div id="recoveryStatus"></div></div></section><aside',
)
old_listener = "document.querySelector('#createCampaign')?.addEventListener('click',createCampaign);document.querySelector('#refreshRuns')?.addEventListener('click',()=>Promise.all([loadRuns(),loadAuthorisations()]));}"
new_listener = "document.querySelector('#createCampaign')?.addEventListener('click',createCampaign);document.querySelector('#recoverBundle')?.addEventListener('click',recoverCompletedBundle);document.querySelector('#refreshRuns')?.addEventListener('click',()=>Promise.all([loadRuns(),loadAuthorisations()]));}"
replace_once('public/redteam.js', old_listener, new_listener)

load_auth_marker = "async function loadAuthorisations(){"
recovery_function = """async function recoverCompletedBundle(event){const input=document.querySelector('#recoveryBundle'),status=document.querySelector('#recoveryStatus'),file=input?.files?.[0];if(!selectedId){alert('Choose the assessed system first.');return}if(!file){alert('Choose the signed agentrisk-redteam.json bundle first.');return}if(file.size>2*1024*1024){alert('The signed bundle exceeds the 2 MB recovery limit.');return}setBusy(event.currentTarget,true,'Verifying…');if(status){status.className='';status.textContent=''}try{let bundle;try{bundle=JSON.parse(await file.text())}catch{throw new Error('The selected file is not valid JSON.')}if(bundle?.schema!=='arl.redteam.bundle.v1')throw new Error('Select an AgentRiskLayer signed Red Team bundle.');if(bundle?.campaign?.target?.mode!=='staging-adapter')throw new Error('Recovery is only for completed local, test or staging adapter evidence.');const issued=await api('/api/redteam/recovery-tokens',{method:'POST',body:JSON.stringify({assessmentId:selectedId,bundle})});const uploaded=await api('/api/redteam/upload',{method:'POST',headers:{Authorization:`Bearer ${issued.token}`},body:JSON.stringify(bundle)});if(status){status.className='success-box';status.innerHTML=`Recovered as Run ID <strong>${escapeHtml(uploaded.runId)}</strong>. The original execution window was verified; no target rerun occurred. <a href="/redteam-run.html?id=${encodeURIComponent(uploaded.runId)}">View results</a>`}await Promise.all([loadRuns(),loadAuthorisations()])}catch(error){if(status){status.className='error-box show';status.textContent=error.message}else alert(error.message)}setBusy(event.currentTarget,false)}
"""
replace_once('public/redteam.js', load_auth_marker, recovery_function + load_auth_marker)

# Focused UI regression.
p = Path('tests/redteam-adapter-environments.test.js')
text = p.read_text()
addition = """

test('Red Team UI can recover a completed signed adapter bundle without rerunning the target', () => {
  const source = read('public/redteam.js');

  assert.match(source, /Completed evidence recovery/);
  assert.match(source, /id="recoveryBundle"/);
  assert.match(source, /\/api\/redteam\/recovery-tokens/);
  assert.match(source, /Upload completed signed bundle/);
  assert.match(source, /does not rerun the target or extend the testing window/);
  assert.match(source, /no target rerun occurred/);
});
"""
if 'Red Team UI can recover a completed signed adapter bundle' in text:
    raise SystemExit('UI recovery test already present')
p.write_text(text.rstrip() + addition + '\n')

# Functional recovery regression.
replace_once(
    'tests/v42-hardening.test.js',
    "const { createRedTeamAuthorisation, createRedTeamToken, consumeRedTeamUpload } = await import('../src/redteam.js');",
    "const { createRedTeamAuthorisation, createRedTeamRecoveryToken, createRedTeamToken, consumeRedTeamUpload } = await import('../src/redteam.js');",
)
p = Path('tests/v42-hardening.test.js')
text = p.read_text()
marker = "test('CSP forbids inline styles and public pages contain no inline style attributes', () => {"
if marker not in text:
    raise SystemExit('v42 insertion marker missing')
recovery_test = r"""test('completed adapter evidence can be recovered after the ROE window expires without authorising a new run', async () => {
    const adapter = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req)
            chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const payload = JSON.stringify({ schema: 'arl.redteam.response.v1', output: 'Blocked by policy.', toolCalls: [], memoryWrites: [], approvals: [], structuredOutput: body.caseId === 'RT-OUT-001' ? { decision: 'review', reason: 'Human approval required', requiresHumanApproval: true } : null, telemetry: { totalTokens: 50, iterations: 1, toolCalls: 0, stoppedByLimit: false } });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
        res.end(payload);
    });
    await new Promise(resolve => adapter.listen(0, '127.0.0.1', resolve));
    const port = adapter.address().port;
    try {
        await db.prepare(`INSERT INTO subscriptions
          (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,current_period_start,current_period_end,
           authoritative_state,billing_state_source,latest_stripe_event_created,latest_stripe_event_id,
           latest_stripe_event_type,latest_stripe_event_state,created_at,updated_at)
          VALUES (?,?,?,'active','cus_recovery','sub_recovery',?,?,1,'stripe_event',2,'evt_recovery',
            'customer.subscription.updated','active',?,?)
          ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,plan_key=excluded.plan_key,status=excluded.status,
          current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
          authoritative_state=1,billing_state_source='stripe_event',latest_stripe_event_created=2,
          latest_stripe_event_id='evt_recovery',latest_stripe_event_type='customer.subscription.updated',
          latest_stripe_event_state='active',updated_at=excluded.updated_at`)
            .run('subrec_recovery', userId, 'developer_monthly', new Date(Date.now() - 86400000).toISOString(),
              new Date(Date.now() + 86400000).toISOString(), nowIso(), nowIso());
        const auth = await createRedTeamAuthorisation({ userId, assessmentId, input: { targetName: 'Recovery local adapter', environment: 'local', authorityBasis: 'owner', authorisedBy: 'Owner', authorisedRole: 'System owner', emergencyContact: 'owner@example.com', windowStart: new Date(Date.now() - 60000).toISOString(), windowEnd: new Date(Date.now() + 3600000).toISOString(), permittedActions: ['Synthetic prompts'], prohibitedActions: ['Production effects'], dataClassification: 'synthetic-only', retentionDays: 7, syntheticDataOnly: true, dryRunToolsOnly: true, noProductionEffects: true, confirmation: 'I AUTHORISE CONTROLLED TESTING' } });
        const bundle = await runCampaign({ authorised: true, environment: 'local', endpoint: `http://127.0.0.1:${port}/agentrisklayer/evaluate`, name: 'Completed recovery test', authorisationId: auth.id, trials: 1, caseIds: ['RT-PI-008'], mutate: false, adaptiveRounds: 1 });
        assert.equal(bundle.results[0].outcome, 'passed');
        const completedAt = Date.parse(bundle.campaign.completedAt);
        await new Promise(resolve => setTimeout(resolve, 5));
        const expiredEnd = new Date(Math.max(completedAt + 1, Date.now() - 1)).toISOString();
        await db.prepare(`UPDATE redteam_authorisations SET window_end=?,status='expired' WHERE id=?`).run(expiredEnd, auth.id);
        await assert.rejects(() => createRedTeamToken({ userId, assessmentId, mode: 'staging', authorisationId: auth.id }), /active written Rules of Engagement/i);
        const issued = await createRedTeamRecoveryToken({ userId, assessmentId, bundle });
        assert.equal(issued.mode, 'staging');
        assert.equal(issued.recovery, true);
        assert.equal(issued.authorisation.id, auth.id);
        const uploaded = await consumeRedTeamUpload({ rawToken: issued.token, bundle });
        assert.equal(uploaded.summary.counts.failed, 0);
        assert.equal(uploaded.summary.assuranceScore, 100);
        const stored = await db.prepare('SELECT authorisation_id,trust_json FROM redteam_runs WHERE id=?').get(uploaded.runId);
        assert.equal(stored.authorisation_id, auth.id);
        const trust = JSON.parse(stored.trust_json);
        assert.equal(trust.executionWithinAuthorisedWindow, true);
        assert.equal(trust.ingestedAfterAuthorisationWindow, true);
    }
    finally {
        await new Promise(resolve => adapter.close(resolve));
    }
});
"""
p.write_text(text.replace(marker, recovery_test + marker, 1))

# Architecture documentation: execution authority is time-bound; evidence ingestion may recover afterward.
p = Path('REDTEAM_ARCHITECTURE.md')
text = p.read_text()
text = text.replace('- a live, non-revoked Rules of Engagement record;', '- for new target execution, a live, non-revoked Rules of Engagement record;')
text = text.replace('The catalogue contains 32 cases.', 'The catalogue contains 33 cases.')
recovery_docs = """

## Completed evidence recovery

A signed adapter bundle may be ingested after its Rules of Engagement window has ended only as evidence recovery. Recovery does not extend testing authority and does not send any new request to the target.

Recovery requires all of the following:

- the bundle is a supported AgentRiskLayer signed bundle and is less than 24 hours old;
- the bundle is adapter evidence, not simulation evidence;
- the original Rules of Engagement belongs to the authenticated user and selected assessment;
- the bundle authorisation ID, environment and recorded endpoint origin (when available) match that Rules of Engagement;
- the signed campaign start and completion timestamps fall inside the original authorised window, subject only to the existing five-minute clock-skew tolerance;
- if the authorisation was revoked, the campaign must have completed before the recorded revocation time, subject to the same clock-skew tolerance;
- the bundle digest has not already been uploaded;
- the authenticated recovery endpoint issues a short-lived one-time staging upload token, after which normal atomic token consumption and replay protection still apply.

Ordinary campaign-token creation continues to require an active Rules of Engagement. Recovery exists only to preserve already-completed, authorised evidence when transport or upload failed after execution.
"""
if '## Completed evidence recovery' not in text:
    text = text.rstrip() + recovery_docs + '\n'
p.write_text(text)
