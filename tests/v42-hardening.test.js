import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cryptoModule from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `v42-hardening-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.DATABASE_PATH = dbPath;
process.env.DEMO_MODE = 'true';
process.env.NODE_ENV = 'development';
process.env.BASE_URL = 'http://localhost:3000';
process.env.SESSION_SECRET = 'v42-hardening-secret-123456789012345678901';
process.env.ADMIN_EMAIL = 'owner@example.com';

const { db, id, nowIso } = await import('../src/db.js');
const { registerUser, verifyPassword, beginMfaSetup, enableMfa, authenticateUser, createMfaLoginChallenge, completeMfaLogin, publicUser } = await import('../src/auth.js');
const { questionnaire, evaluateAssessment } = await import('../src/risk-engine.js');
const { fulfilCheckout, processFulfilmentJob } = await import('../src/fulfilment.js');
const { enforceRetention } = await import('../src/retention.js');
const { createRedTeamAuthorisation, createRedTeamToken, consumeRedTeamUpload } = await import('../src/redteam.js');
const { runCampaign } = await import('../redteam/agent-risk-redteam.mjs');
const { applySecurityHeaders, primaryRateLimitAllowed, rateLimitAllowed, resolveClientIp } = await import('../src/security.js');

let userId;
let assessmentId;

test.before(async () => {
  const user = await registerUser('owner@example.com', 'Strong-password-42', true);
  userId = user.id;
  db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(nowIso(), userId);
  const answers = Object.fromEntries(questionnaire.map((question) => [question.id, { value: question.options[2].value, evidence: 'documented' }]));
  const result = evaluateAssessment(answers);
  assessmentId = id('asm_');
  const now = nowIso();
  db.prepare(`INSERT INTO assessments (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'free',?,?,0,?,?,?)`).run(assessmentId,userId,'Payment resilience agent','Finance agent',JSON.stringify(answers),result.score,result.riskBand,JSON.stringify(result),id('access_'),id('share_'),'arl-risk-v3.2',now,now);
  db.prepare(`INSERT INTO redteam_runs (id,user_id,assessment_id,authorisation_id,schema_version,runner_version,policy_version,bundle_digest,signature_valid,campaign_json,scope_json,summary_json,results_json,trust_json,delta_json,retention_expires_at,created_at)
    VALUES (?,?,?,NULL,'arl.redteam.bundle.v1','4.2.0','arl-redteam-policy-2026.08',?,1,?,?,?,?,?,?,NULL,?)`)
    .run(id('rtr_'),userId,assessmentId,'a'.repeat(64),JSON.stringify({target:{mode:'staging-adapter'},name:'Existing controlled campaign'}),JSON.stringify({environment:'test'}),JSON.stringify({riskScore:80,assuranceScore:20,counts:{failed:1,critical:1,high:0,medium:0,passed:0}}),JSON.stringify([{caseId:'RT-PI-001',title:'Direct injection',outcome:'failed',severity:'critical',evidence:['Unsafe instruction followed'],remediation:'Enforce instruction hierarchy.'}]),JSON.stringify({signatureValid:true}),JSON.stringify({status:'first-run'}),now);
});

test.after(() => {
  try { db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});

test('public user representations never expose internal session token hashes', () => {
  const user = publicUser({ id:'usr_test', email:'test@example.com', session_token_hash:'internal-hash', email_verified_at:nowIso(), created_at:nowIso() });
  assert.equal(Object.hasOwn(user, 'sessionTokenHash'), false);
  assert.doesNotMatch(JSON.stringify(user), /internal-hash/);
});

test('paid checkout grants access transactionally and retries report delivery with complete evidence', async () => {
  const session = { id:'cs_v42_resilience', mode:'payment', payment_status:'paid', amount_total:7900, currency:'gbp', customer:'cus_v42', metadata:{user_id:userId,assessment_id:assessmentId,product_key:'pro_report'} };
  const purchase = await fulfilCheckout(session, { processEmailNow:false });
  assert.equal(purchase.fulfilment_state, 'fulfilled');
  assert.equal(db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(assessmentId).paid_tier, 'pro');
  const job = db.prepare('SELECT * FROM fulfilment_jobs WHERE purchase_id=?').get(purchase.id);
  assert.equal(job.status, 'queued');
  const failed = await processFulfilmentJob(job.id, { renderPdf: async()=>Buffer.from('%PDF-1.4 test'), sendReport: async()=>{ throw new Error('provider unavailable'); } });
  assert.equal(failed, false);
  let after = db.prepare('SELECT * FROM fulfilment_jobs WHERE id=?').get(job.id);
  assert.equal(after.status, 'failed');
  db.prepare('UPDATE fulfilment_jobs SET next_attempt_at=? WHERE id=?').run(nowIso(),job.id);
  const recovered = await processFulfilmentJob(job.id, { renderPdf: async()=>Buffer.from('%PDF-1.4 test'), sendReport: async()=>({id:'email_ok'}) });
  assert.equal(recovered, true);
  after = db.prepare('SELECT * FROM fulfilment_jobs WHERE id=?').get(job.id);
  assert.equal(after.status, 'completed');
  const completePurchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(purchase.id);
  assert.equal(completePurchase.email_state, 'sent');
  assert.match(completePurchase.report_snapshot_json, /Existing controlled campaign/);
  const digest = (await import('node:crypto')).createHash('sha256').update(completePurchase.report_snapshot_json).digest('hex');
  assert.equal(completePurchase.report_digest, digest);
});

test('password verification uses asynchronous scrypt without monopolising the event loop', async () => {
  const hash = db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash;
  let ticks = 0;
  const timer = setInterval(()=>{ticks += 1;},1);
  const outcomes = await Promise.all(Array.from({length:6},()=>verifyPassword('Strong-password-42',hash)));
  clearInterval(timer);
  assert.ok(outcomes.every(Boolean));
  assert.ok(ticks > 0, `event loop did not progress; ticks=${ticks}`);
});


test('email-verified accounts can enable TOTP MFA and complete a protected sign-in', async () => {
  const setup = await beginMfaSetup(userId, 'Strong-password-42');
  assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);
  const code = totp(setup.secret);
  const enabled = await enableMfa(userId, { password:'Strong-password-42', secret:setup.secret, code });
  assert.equal(enabled.recoveryCodes.length, 10);
  const authenticated = await authenticateUser('owner@example.com','Strong-password-42');
  assert.equal(authenticated.mfaEnabled, true);
  const challenge = createMfaLoginChallenge(userId);
  assert.equal(completeMfaLogin(challenge.challengeToken, totp(setup.secret)), userId);
});

test('primary rate policy keeps health and public reads available during bounded bursts', () => {
  const healthReq = { method:'GET', headers:{'x-forwarded-for':'203.0.113.42'}, socket:{remoteAddress:'127.0.0.1'} };
  const publicReq = { method:'GET', headers:{'x-forwarded-for':'203.0.113.43'}, socket:{remoteAddress:'127.0.0.1'} };
  for (let i=0;i<600;i+=1) assert.equal(primaryRateLimitAllowed(healthReq, '/api/health'), true);
  for (let i=0;i<300;i+=1) assert.equal(primaryRateLimitAllowed(publicReq, '/'), true);
});

test('trusted-proxy rate limiting cannot be bypassed by changing the left-most forwarded address', () => {
  const reqA = { headers:{'x-forwarded-for':'1.1.1.1, 9.9.9.9'}, socket:{remoteAddress:'127.0.0.1'} };
  const reqB = { headers:{'x-forwarded-for':'2.2.2.2, 9.9.9.9'}, socket:{remoteAddress:'127.0.0.1'} };
  assert.equal(resolveClientIp(reqA),'9.9.9.9');
  assert.equal(resolveClientIp(reqB),'9.9.9.9');
  assert.equal(rateLimitAllowed(reqA,{bucket:'spoof-test',windowMs:60000,max:1}),true);
  assert.equal(rateLimitAllowed(reqB,{bucket:'spoof-test',windowMs:60000,max:1}),false);
});

test('expired red-team evidence is deleted with a receipt while legal hold is preserved', () => {
  const now = nowIso();
  const authId=id('roe_');
  db.prepare(`INSERT INTO redteam_authorisations (id,user_id,assessment_id,target_name,endpoint_origin,environment,authority_basis,authorised_by,authorised_role,emergency_contact,window_start,window_end,permitted_actions_json,prohibited_actions_json,data_classification,retention_days,synthetic_data_only,dry_run_tools_only,status,attestation_text,accepted_at,revoked_at,created_at,legal_hold)
    VALUES (?,?,?,'Expired target',NULL,'test','owner','Owner','Owner','owner@example.com',?,?, '[]','[]','synthetic-only',1,1,1,'expired','I AUTHORISE CONTROLLED TESTING',?,NULL,?,0)`)
    .run(authId,userId,assessmentId,new Date(Date.now()-3*86400000).toISOString(),new Date(Date.now()-2*86400000).toISOString(),now,now);
  db.prepare(`INSERT INTO redteam_runs (id,user_id,assessment_id,authorisation_id,schema_version,runner_version,policy_version,bundle_digest,signature_valid,campaign_json,scope_json,summary_json,results_json,trust_json,delta_json,retention_expires_at,created_at)
    VALUES (?,?,?,?,'arl.redteam.bundle.v1','4.2.0','policy',?,1,'{}','{}','{}','[]','{}','{}',?,?)`)
    .run(id('rtr_'),userId,assessmentId,authId,'b'.repeat(64),new Date(Date.now()-86400000).toISOString(),now);
  const result = enforceRetention();
  assert.ok(result.recordsDeleted >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM redteam_runs WHERE authorisation_id=?').get(authId).count,0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM data_purge_receipts WHERE authorisation_id=?').get(authId).count,1);

  const holdId=id('roe_');
  db.prepare(`INSERT INTO redteam_authorisations (id,user_id,assessment_id,target_name,endpoint_origin,environment,authority_basis,authorised_by,authorised_role,emergency_contact,window_start,window_end,permitted_actions_json,prohibited_actions_json,data_classification,retention_days,synthetic_data_only,dry_run_tools_only,status,attestation_text,accepted_at,revoked_at,created_at,legal_hold)
    VALUES (?,?,?,'Held target',NULL,'test','owner','Owner','Owner','owner@example.com',?,?, '[]','[]','synthetic-only',1,1,1,'expired','I AUTHORISE CONTROLLED TESTING',?,NULL,?,1)`)
    .run(holdId,userId,assessmentId,new Date(Date.now()-3*86400000).toISOString(),new Date(Date.now()-2*86400000).toISOString(),now,now);
  db.prepare(`INSERT INTO redteam_runs (id,user_id,assessment_id,authorisation_id,schema_version,runner_version,policy_version,bundle_digest,signature_valid,campaign_json,scope_json,summary_json,results_json,trust_json,delta_json,retention_expires_at,created_at)
    VALUES (?,?,?,?,'arl.redteam.bundle.v1','4.2.0','policy',?,1,'{}','{}','{}','[]','{}','{}',?,?)`)
    .run(id('rtr_'),userId,assessmentId,holdId,'c'.repeat(64),new Date(Date.now()-86400000).toISOString(),now);
  enforceRetention();
  assert.equal(db.prepare('SELECT COUNT(*) count FROM redteam_runs WHERE authorisation_id=?').get(holdId).count,1);
});


test('staging evidence is rejected when execution falls outside the authorised time window', async () => {
  const adapter = http.createServer(async (req,res) => {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const payload=JSON.stringify({schema:'arl.redteam.response.v1',output:'Blocked by policy.',toolCalls:[],memoryWrites:[],approvals:[],structuredOutput:body.caseId==='RT-OUT-001'?{decision:'review',reason:'Human approval required',requiresHumanApproval:true}:null,telemetry:{totalTokens:50,iterations:1,toolCalls:0,stoppedByLimit:false}});
    res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)});res.end(payload);
  });
  await new Promise(resolve=>adapter.listen(0,'127.0.0.1',resolve));
  const port=adapter.address().port;
  try {
    db.prepare(`INSERT OR REPLACE INTO subscriptions (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,current_period_end,created_at,updated_at) VALUES (?,?,?,'active','cus_test','sub_test',?,?,?)`).run('subrec_v42',userId,'developer_monthly',new Date(Date.now()+86400000).toISOString(),nowIso(),nowIso());
    const auth=createRedTeamAuthorisation({userId,assessmentId,input:{targetName:'Window-bound local adapter',environment:'local',authorityBasis:'owner',authorisedBy:'Owner',authorisedRole:'System owner',emergencyContact:'owner@example.com',windowStart:new Date(Date.now()-60000).toISOString(),windowEnd:new Date(Date.now()+3600000).toISOString(),permittedActions:['Synthetic prompts'],prohibitedActions:['Production effects'],dataClassification:'synthetic-only',retentionDays:7,syntheticDataOnly:true,dryRunToolsOnly:true,noProductionEffects:true,confirmation:'I AUTHORISE CONTROLLED TESTING'}});
    const issued=createRedTeamToken({userId,assessmentId,mode:'staging',authorisationId:auth.id});
    const bundle=await runCampaign({authorised:true,environment:'local',endpoint:`http://127.0.0.1:${port}/agentrisklayer/evaluate`,name:'Window test',authorisationId:auth.id,trials:1});
    db.prepare('UPDATE redteam_authorisations SET window_start=?,window_end=? WHERE id=?').run(new Date(Date.now()+10*60000).toISOString(),new Date(Date.now()+2*3600000).toISOString(),auth.id);
    assert.throws(()=>consumeRedTeamUpload({rawToken:issued.token,bundle}),/outside the authorised.*time window/i);
  } finally { await new Promise(resolve=>adapter.close(resolve)); }
});

test('CSP forbids inline styles and public pages contain no inline style attributes', () => {
  const headers = new Map();
  applySecurityHeaders({ setHeader:(key,value)=>headers.set(key,value) });
  const csp = headers.get('Content-Security-Policy');
  assert.doesNotMatch(csp,/unsafe-inline/);
  const files = fs.readdirSync(path.join(root,'public')).filter(name=>/\.(?:html|js)$/.test(name));
  for (const name of files) assert.doesNotMatch(fs.readFileSync(path.join(root,'public',name),'utf8'),/\sstyle\s*=/i, name);
});

test('Agency pricing makes no unimplemented workspace claim', () => {
  const source=fs.readFileSync(path.join(root,'public','pricing.js'),'utf8');
  assert.doesNotMatch(source,/client assessment and inspection workspaces/i);
  assert.match(source,/Multi-assessment portfolio/);
});


function totp(secret, now=Date.now()) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,value=0,bytes=[];
  for(const char of secret.replace(/=+$/,'')){value=(value<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  const counter=Math.floor(now/1000/30);const buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(BigInt(counter));
  const digest=(awaitImportCrypto()).createHmac('sha1',Buffer.from(bytes)).update(buffer).digest();
  const offset=digest[digest.length-1]&15;const number=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
  return String(number%1000000).padStart(6,'0');
}
function awaitImportCrypto(){ return globalThis.__arlCrypto ||= requireCrypto(); }
function requireCrypto(){ return cryptoModule; }
