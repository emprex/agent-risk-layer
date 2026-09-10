import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceExact(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 exact match, found ${count}`);
  return source.replace(before, after);
}
function removeBetween(source, start, end, label) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || b <= a) throw new Error(`${label}: boundary not found`);
  return source.slice(0, a) + source.slice(b);
}
function replaceRegex(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected one regex match`);
  return source.replace(pattern, replacement);
}

let server = read('server.js');
server = replaceExact(server,
  "import { assertSafeProductionConfig, config, launchReadiness, plans } from './src/config.js';",
  "import { assertSafeProductionConfig, config, launchReadiness } from './src/config.js';",
  'config import');
for (const line of [
  "import { publicCommercialCatalogue } from './src/commercial-catalogue.js';\n",
  "import { bindPendingCheckoutSession, createPendingCheckout, failPendingCheckoutCreation, fulfilCheckout, fulfilmentOperations, processDueFulfilmentJobs, processPurchaseJobs, reconcileIncompletePurchases, resolveOperationalAlert, startFulfilmentWorker } from './src/fulfilment.js';\n",
  "import { claimStripeEvent, completeStripeEvent, failStripeEvent, recoverAbandonedStripeEvent } from './src/stripe-events.js';\n",
  "import { subscriptionAccessDecision, subscriptionBlocksAccountDeletion, subscriptionBlocksCheckout } from './src/subscription-access.js';\n",
  "import { processStripeEvent } from './src/stripe-webhook.js';\n",
]) server = replaceExact(server, line, '', `remove import ${line.trim()}`);

server = replaceExact(server,
  "        if (req.method === 'POST' && url.pathname === '/api/stripe/webhook')\n            return await handleStripeWebhook(req, res);\n",
  '', 'stripe webhook route');
server = removeBetween(server,
  "        if (req.method === 'GET' && url.pathname === '/api/config') {",
  "        if (req.method === 'GET' && url.pathname === '/api/questionnaire')",
  'public config catalogue');
server = server.replace(
  "        if (req.method === 'GET' && url.pathname === '/api/questionnaire')",
  "        if (req.method === 'GET' && url.pathname === '/api/config') {\n            return json(res, 200, {\n                demoMode: config.demoMode,\n                version: config.appVersion,\n                productStage: config.productStage,\n                termsVersion: config.termsVersion,\n                supportEmail: config.supportEmail,\n                user: req.user,\n            });\n        }\n        if (req.method === 'GET' && url.pathname === '/api/questionnaire')"
);

server = replaceExact(server,
  "            const subscribed = Boolean(isOwner && await hasActiveSubscription(req.user.id));\n            const superuserAccess = Boolean(isOwner && req.user?.isSuperuser);\n            const effectiveTier = subscribed || superuserAccess ? 'pro' : row.paid_tier;",
  "            const superuserAccess = Boolean(isOwner && req.user?.isSuperuser);\n            const effectiveTier = superuserAccess ? 'pro' : row.paid_tier;",
  'assessment subscription access');
server = replaceExact(server,
  "            return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier, inspection, redTeamRun), canDownload: effectiveTier !== 'free', isOwner, subscriptionAccess: subscribed, superuserAccess, revisionSource, inspection, redTeamRun });",
  "            return json(res, 200, { assessment: accessibleAssessment(row, effectiveTier, inspection, redTeamRun), canDownload: effectiveTier !== 'free', isOwner, superuserAccess, revisionSource, inspection, redTeamRun });",
  'assessment response subscription field');

server = removeBetween(server,
  "        if (req.method === 'POST' && url.pathname === '/api/checkout') {",
  "        match = url.pathname.match(/^\\/api\\/reports\\/([^/]+)\\/pdf$/);",
  'checkout and billing routes');
server = removeBetween(server,
  "        if (req.method === 'GET' && url.pathname === '/api/admin/operations') {",
  "        if (req.method === 'GET' && url.pathname === '/api/admin/readiness') {",
  'billing operations routes');
server = replaceExact(server,
  "        if (req.method === 'GET' && ['/privacy', '/privacy.html'].includes(url.pathname))\n            return html(res, 200, renderPrivacyPage());\n        if (req.method === 'GET' && ['/terms', '/terms.html'].includes(url.pathname))\n            return html(res, 200, renderTermsPage());\n",
  '', 'dynamic legal routes');

server = removeBetween(server, 'async function handleStripeWebhook(req, res) {', 'async function handleInspectionUpload(req, res) {', 'stripe webhook handler');
server = removeBetween(server, 'async function createCheckout(req, res, body) {', 'async function downloadReport(req, res, assessmentId, token) {', 'checkout handlers');
server = replaceExact(server,
  "    const subscribed = Boolean(isOwner && await hasActiveSubscription(req.user.id));\n    const effectiveTier = subscribed || (isOwner && req.user?.isSuperuser) ? 'pro' : row.paid_tier;\n    if ((!hasToken && !isOwner) || effectiveTier === 'free')\n        return json(res, 403, { error: 'A paid report or active subscription is required.' });",
  "    const effectiveTier = (isOwner && req.user?.isSuperuser) ? 'pro' : row.paid_tier;\n    if ((!hasToken && !isOwner) || effectiveTier === 'free')\n        return json(res, 403, { error: 'Report access has not been granted for this assessment.' });",
  'report subscription gate');
server = replaceExact(server,
  "    if (await hasSubscriptionBlockingAccountDeletion(req.user.id))\n        return json(res, 409, { error: 'Cancel or resolve the subscription from billing before deleting the account.' });\n",
  '', 'account deletion billing blocker');

server = replaceRegex(server,
  /async function dashboard\(req, res\) \{[\s\S]*?\nasync function adminAnalytics\(req, res\) \{[\s\S]*?\nasync function stripeRequest\(method, endpoint, params = null\) \{[\s\S]*?\nasync function serveBadge\(res, shareToken\) \{/,
`async function dashboard(req, res) {
    const assessments = (await db.prepare(\`
    SELECT a.id,a.name,a.agent_type,a.score,a.risk_band,a.paid_tier,a.access_token,a.share_token,a.public_enabled,
      a.scoring_version,a.created_at,
      (SELECT i.summary_json FROM inspections i WHERE i.assessment_id=a.id ORDER BY i.created_at DESC LIMIT 1) latest_inspection_summary,
      (SELECT i.created_at FROM inspections i WHERE i.assessment_id=a.id ORDER BY i.created_at DESC LIMIT 1) latest_inspection_at,
      (SELECT r.summary_json FROM redteam_runs r WHERE r.assessment_id=a.id ORDER BY r.created_at DESC LIMIT 1) latest_redteam_summary,
      (SELECT r.created_at FROM redteam_runs r WHERE r.assessment_id=a.id ORDER BY r.created_at DESC LIMIT 1) latest_redteam_at
    FROM assessments a WHERE a.user_id=? ORDER BY a.created_at DESC\`).all(req.user.id)).map((row) => ({ ...row, latest_inspection_summary: parseJson(row.latest_inspection_summary, null),
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
    const funnel = await db.prepare(\`SELECT name,COUNT(*) count FROM events GROUP BY name ORDER BY count DESC\`).all();
    const recentFailures = await db.prepare(\`SELECT to_email,subject,error,created_at FROM email_log WHERE status='failed' ORDER BY created_at DESC LIMIT 10\`).all();
    const riskBands = await db.prepare(\`SELECT risk_band band,COUNT(*) count FROM assessments GROUP BY risk_band ORDER BY count DESC\`).all();
    return json(res, 200, { totals, funnel, recentFailures, riskBands, readiness: launchReadiness(), retention: await retentionOverview() });
}
async function serveBadge(res, shareToken) {`,
  'dashboard admin and stripe helpers');
server = removeBetween(server, 'async function hasActiveSubscription(userId) {', 'function parseResult(row) {', 'subscription helper functions');
server = removeBetween(server, 'function legalOperator() {', 'function renderRobots() {', 'dynamic legal renderer');
server = replaceExact(server, 'await startFulfilmentWorker();\n', '', 'fulfilment worker startup');

server = replaceRegex(server,
  /function renderRobots\(\) \{[\s\S]*?\nfunction renderSitemap\(\) \{[\s\S]*?\nfunction renderSecurityTxt\(\) \{[\s\S]*?\nconst seoPages =/,
`function renderRobots() {
    return \`User-agent: *\\nAllow: /\\nDisallow: /dashboard.html\\nDisallow: /admin.html\\nDisallow: /auth.html\\nDisallow: /reset.html\\nDisallow: /result.html\\nDisallow: /assessment.html\\nDisallow: /control-plane.html\\nDisallow: /control-intelligence.html\\nDisallow: /inspector.html\\nSitemap: \${config.baseUrl}/sitemap.xml\\n\`;
}
function renderSitemap() {
    const paths = ['/', '/ai-agent-security-assessment.html', '/pricing.html', '/request-assessment.html', '/sample-report.html', '/trust.html', '/security-center.html', '/methodology.html', '/standards.html', '/help.html', '/company.html', '/status.html', '/legal/privacy.html', '/legal/terms.html', ...Object.keys(seoPages).map((slug) => \`/checks/\${slug}\`)];
    return \`<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\${paths.map((item) => \`<url><loc>\${escapeXml(config.baseUrl + item)}</loc></url>\`).join('')}</urlset>\`;
}
function renderSecurityTxt() {
    const contact = config.supportEmail ? \`mailto:\${config.supportEmail}\` : config.baseUrl;
    return \`Contact: \${contact}\\nCanonical: \${config.baseUrl}/.well-known/security.txt\\nPolicy: \${config.baseUrl}/legal/terms.html\\nExpires: \${new Date(Date.now() + 365 * 86400000).toISOString()}\\n\`;
}
const seoPages =`,
  'discovery renderers');
server = replaceRegex(server,
  /function renderSeoPage\(page\) \{[\s\S]*?\n\}\nassertSafeProductionConfig\(\);/,
`function renderSeoPage(page) {
    return \`<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>\${page.title} | AgentRiskLayer</title><meta name=\"description\" content=\"\${page.description}\"><link rel=\"stylesheet\" href=\"/marketing.css\"></head><body><header class=\"marketing-header\"><a class=\"brand\" href=\"/\">AgentRiskLayer</a><nav class=\"marketing-nav\"><a href=\"/ai-agent-security-assessment.html\">Assessment</a><a href=\"/pricing.html\">Pricing</a><a class=\"nav-cta\" href=\"/request-assessment.html\">Request an Assessment</a></nav></header><main><section class=\"page-hero narrow\"><p class=\"eyebrow\">AI agent security assessment</p><h1>\${page.title}</h1><p class=\"lede\">\${page.description}</p><div class=\"actions\"><a class=\"button primary\" href=\"/request-assessment.html\">Request an Assessment</a><a class=\"button secondary\" href=\"/sample-report.html\">See an example report</a></div></section></main><footer class=\"marketing-footer\"><div><strong>AgentRiskLayer</strong><span>AI agent security assessment before production.</span></div><nav><a href=\"/legal/privacy.html\">Privacy</a><a href=\"/legal/terms.html\">Terms</a></nav></footer></body></html>\`;
}
assertSafeProductionConfig();`,
  'service-first SEO page');

const forbiddenServer = [
  '/api/stripe/webhook', '/api/checkout', '/api/billing/portal', '/api/subscriptions/demo-cancel',
  'createCheckout(', 'handleStripeWebhook(', 'stripeRequest(', 'publicCommercialCatalogue', 'startFulfilmentWorker',
  'subscriptionAccessDecision', 'subscriptionBlocksCheckout', 'subscriptionBlocksAccountDeletion', 'plans } from',
];
for (const token of forbiddenServer) if (server.includes(token)) throw new Error(`server.js still contains retired commercial token: ${token}`);
write('server.js', server);

let core = read('src/control-plane-core.js');
core = replaceExact(core, "import { subscriptionAccessDecision } from './subscription-access.js';\n", '', 'control plane subscription import');
core = replaceExact(core, "import { PLAN_ENTITLEMENTS } from './commercial-catalogue.js';\n", '', 'control plane catalogue import');
core = replaceExact(core, "export { PLAN_ENTITLEMENTS };\n\n", '', 'control plane catalogue export');
core = replaceExact(core,
  "export const GUIDED_PROTECTION_CHECK_SCHEMA = 'arl.guided-protection-check.v1';",
  "export const GUIDED_PROTECTION_CHECK_SCHEMA = 'arl.guided-protection-check.v1';\nexport const SERVICE_ENTITLEMENT = Object.freeze({ key: 'service', name: 'AgentRiskLayer Service', projects: 1, runtimeRequestsPerMonth: 10_000, runtimeRequestsPerMinute: 60, retentionDays: 7, apiKeysPerProject: 2, redTeamRuns: 0 });",
  'service entitlement');
core = replaceRegex(core,
  /export async function entitlementForUser\(userId\) \{[\s\S]*?\n\}\n\nexport async function createSecurityProject/,
  "export async function entitlementForUser(userId) {\n  void userId;\n  return { ...SERVICE_ENTITLEMENT, subscription: null };\n}\n\nexport async function createSecurityProject",
  'control plane entitlement');
core = core.replace(/throw paymentRequired\(`\$\{entitlement\.name\} supports \$\{entitlement\.projects\} active project\$\{entitlement\.projects === 1 \? '' : 's'\}\. Upgrade to add another\.`\);/,
  "throw forbidden(`${entitlement.name} supports ${entitlement.projects} active project${entitlement.projects === 1 ? '' : 's'} in the current service context.`);");
if (/subscriptionAccessDecision|PLAN_ENTITLEMENTS|commercial-catalogue|subscription-access/.test(core)) throw new Error('control-plane-core.js still references retired commercial entitlement code');
write('src/control-plane-core.js', core);

let redteam = read('src/redteam.js');
redteam = replaceExact(redteam, "import { subscriptionAccessDecision } from './subscription-access.js';\n", '', 'redteam subscription import');
redteam = replaceExact(redteam, "import { COMMERCIAL_CATALOGUE } from './commercial-catalogue.js';\n", '', 'redteam catalogue import');
redteam = replaceRegex(redteam,
  /        const subscriptions = await db\.prepare\(`[\s\S]*?        entitlement = \{[\s\S]*?        \};\n    \}\);/,
`        const superuser = Boolean(await db.prepare(\`SELECT 1 ok FROM users WHERE id=? AND role='superuser'\`).get(userId));
        const assessmentRuns = Number((await db.prepare('SELECT COUNT(*) AS count FROM redteam_runs WHERE assessment_id = ?').get(assessmentId)).count || 0);
        const activeAssessmentReservations = Number((await db.prepare(\`SELECT COUNT(*) AS count FROM redteam_tokens
          WHERE assessment_id = ? AND used_at IS NULL AND expires_at > ?\`).get(assessmentId, createdAt)).count || 0);
        const limit = superuser ? Number.MAX_SAFE_INTEGER : (assessment.paid_tier === 'pro' ? 2 : 0);
        if (!limit)
            throw new Error('An authorised assessment context is required for controlled red-team evidence.');
        if (!superuser && assessmentRuns + activeAssessmentReservations >= limit)
            throw new Error(\`This assessment context includes \${limit} controlled red-team runs. The allowance is used or reserved by an active token.\`);
        await db.prepare(\`INSERT INTO redteam_tokens (id, token_hash, user_id, assessment_id, authorisation_id, mode, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)\`).run(id('rtk_'), hashToken(raw), userId, assessmentId, authorisation?.id || null, requestedMode, expiresAt, createdAt);
        const reserved = superuser ? 0 : activeAssessmentReservations + 1;
        entitlement = {
            source: superuser ? 'superuser' : 'assessment_service',
            limit: superuser ? null : limit,
            used: superuser ? 0 : assessmentRuns,
            reserved,
            remaining: superuser ? null : Math.max(0, limit - assessmentRuns - reserved),
        };
    });`,
  'redteam commercial entitlement');
if (/subscriptionAccessDecision|COMMERCIAL_CATALOGUE|commercial-catalogue|subscription-access/.test(redteam)) throw new Error('redteam.js still references retired commercial code');
write('src/redteam.js', redteam);

let sales = read('src/sales-agent.js');
sales = sales.replace("const stages = ['research', 'qualified', 'contacted', 'replied', 'demo_booked', 'assessment_proposed', 'customer', 'subscription', 'lost'];", "const stages = ['research', 'qualified', 'contacted', 'replied', 'demo_booked', 'assessment_proposed', 'customer', 'lost'];");
sales = sales.replace("const activityTypes = ['research', 'outreach', 'reply', 'follow_up', 'demo', 'proposal', 'assessment_sold', 'subscription_sold', 'note'];", "const activityTypes = ['research', 'outreach', 'reply', 'follow_up', 'demo', 'proposal', 'assessment_sold', 'note'];");
sales = sales.replace(/estimatedValuePence: Math\.max\(0, Number\(input\.estimatedValuePence \|\| 9900\) \|\| 9900\)/, 'estimatedValuePence: Math.max(0, Number(input.estimatedValuePence || 250000) || 250000)');
sales = sales.replace(/based on \$\{signal\}, \$\{company\}'s agent looks suitable for our £99 AI Agent Security Assessment\. It includes a full evidence-bounded report plus customer-operated inspection, controlled-testing, remediation and retest workflows\./,
  "based on ${signal}, ${company}'s agent looks suitable for an AgentRiskLayer AI Agent Security Assessment. Scope starts from £2,500 and includes evidence, authorised testing, remediation guidance, exact retesting and a final report.");
sales = sales.replace(/stage IN \('customer','subscription'\)/g, "stage='customer'");
sales = sales.replace(/stage NOT IN \('customer','subscription','lost'\)/g, "stage NOT IN ('customer','lost')");
write('src/sales-agent.js', sales);

let v42 = read('tests/v42-hardening.test.js');
v42 = replaceExact(v42, "const { bindPendingCheckoutSession, createPendingCheckout, fulfilCheckout, processFulfilmentJob } = await import('../src/fulfilment.js');\n", '', 'v42 fulfilment import');
v42 = replaceRegex(v42, /test\('paid checkout grants access transactionally and retries report delivery with complete evidence',[\s\S]*?\n\}\);\n(?=test\('password verification)/, '', 'v42 paid checkout test');
v42 = v42.replace("VALUES (?,?,?,?,?,?,?,?,'free',?,?,0,?,?,?)", "VALUES (?,?,?,?,?,?,?,?,'pro',?,?,0,?,?,?)");
write('tests/v42-hardening.test.js', v42);

for (const path of [
  'src/fulfilment.js', 'src/stripe-events.js', 'src/stripe-webhook.js', 'src/subscription-access.js', 'src/commercial-catalogue.js',
  'scripts/update-stripe-render-prices.mjs', 'public/pricing.js', 'public/pricing-mode.js', 'public/success.js'
]) fs.rmSync(path, { force: true });

for (const [path, target] of [['public/terms.html','/legal/terms.html'], ['public/privacy.html','/legal/privacy.html'], ['public/success.html','/request-assessment.html']]) {
  write(path, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${target}"><title>AgentRiskLayer</title></head><body><p><a href="${target}">Continue</a></p></body></html>\n`);
}

const serviceTest = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');\ntest('retired commercial runtime is absent',()=>{const server=read('server.js');for(const token of ['/api/stripe/webhook','/api/checkout','/api/billing/portal','publicCommercialCatalogue','startFulfilmentWorker','handleStripeWebhook','createCheckout(','stripeRequest(']) assert.doesNotMatch(server,new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g,'\\\\$&')));});\ntest('production config has no Stripe or commercial catalogue surface',()=>{const config=read('src/config.js');assert.doesNotMatch(config,/STRIPE_|stripeSecret|stripePrices|BILLABLE_PLANS|commercial-catalogue/);});\ntest('canonical legal pages use the current service model',()=>{for(const page of ['public/legal/terms.html','public/legal/privacy.html']){const html=read(page);assert.match(html,/marketing\\.css/);assert.match(html,/London, United Kingdom/);assert.doesNotMatch(html,/Stripe|billing portal/i);}});\n`;
write('tests/service-commercial-model.test.js', serviceTest);

fs.rmSync('scripts/finalize-service-cutover.mjs', { force: true });
fs.rmSync('.github/workflows/finalize-service-cutover.yml', { force: true });
console.log('FINAL_SERVICE_CUTOVER_APPLIED');
