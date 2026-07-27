import path from 'node:path';
const root = process.cwd();
const defaultSessionSecret = 'development-only-change-this-secret-before-deployment-123456';
export const config = {
    appVersion: '9.1.0',
    scoringVersion: 'arl-risk-v3.2',
    termsVersion: process.env.TERMS_VERSION || '2026-07-22',
    productStage: process.env.PRODUCT_STAGE || 'production',
    companyName: process.env.COMPANY_NAME || 'AgentRiskLayer',
    companyLegalName: (process.env.COMPANY_LEGAL_NAME || '').trim(),
    companyAddress: (process.env.COMPANY_ADDRESS || '').trim(),
    legalJurisdiction: (process.env.LEGAL_JURISDICTION || '').trim(),
    supportEmail: (process.env.SUPPORT_EMAIL || '').trim().toLowerCase(),
    port: Number(process.env.PORT || 3000),
    baseUrl: String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    nodeEnv: process.env.NODE_ENV || 'development',
    demoMode: String(process.env.DEMO_MODE ?? 'true').toLowerCase() !== 'false',
    allowDemoInProduction: String(process.env.ALLOW_DEMO_IN_PRODUCTION || 'false').toLowerCase() === 'true',
    sessionSecret: process.env.SESSION_SECRET || defaultSessionSecret,
    databaseUrl: (process.env.DATABASE_URL || '').trim(),
    databaseSsl: String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true',
    databaseSslRejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORISED || 'true').toLowerCase() !== 'false',
    databasePoolMax: Math.max(2, Number(process.env.DATABASE_POOL_MAX || 10)),
    databaseConnectTimeoutMs: Math.max(1000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10000)),
    databaseIdleTimeoutMs: Math.max(5000, Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000)),
    databaseStatementTimeoutMs: Math.max(1000, Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 15000)),
    databaseLockTimeoutMs: Math.max(1000, Number(process.env.DATABASE_LOCK_TIMEOUT_MS || 5000)),
    databasePath: path.resolve(root, process.env.DATABASE_PATH || `./data/test-${process.pid}.sqlite`),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeApiVersion: process.env.STRIPE_API_VERSION || '2026-06-24.dahlia',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'AgentRiskLayer <reports@example.com>',
    adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    sessionIdleHours: Math.max(1, Number(process.env.SESSION_IDLE_HOURS || 12)),
    sessionAbsoluteDays: Math.max(1, Number(process.env.SESSION_ABSOLUTE_DAYS || 30)),
    emailVerificationHours: Math.max(1, Number(process.env.EMAIL_VERIFICATION_HOURS || 24)),
    rateLimitStorage: process.env.RATE_LIMIT_STORAGE || 'postgres',
    trustedProxyHops: Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS || 1)),
    fulfilmentWorkerIntervalMs: Math.max(5000, Number(process.env.FULFILMENT_WORKER_INTERVAL_MS || 30000)),
    retentionWorkerIntervalMs: Math.max(60000, Number(process.env.RETENTION_WORKER_INTERVAL_MS || 60 * 60000)),
    backupRetentionDays: Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 30)),
    metricsToken: (process.env.METRICS_TOKEN || '').trim(),
    stripePrices: {
        pro_report: process.env.STRIPE_PRICE_PRO_REPORT || '',
        developer_monthly: process.env.STRIPE_PRICE_DEVELOPER_MONTHLY || '',
        team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY || '',
        agency_monthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY || '',
    },
};
export const plans = {
    pro_report: {
        key: 'pro_report',
        name: 'AI agent security assessment',
        amountPence: 9900,
        recurring: false,
        reportTier: 'pro',
    },
    developer_monthly: {
        key: 'developer_monthly',
        name: 'Developer',
        amountPence: 2900,
        recurring: true,
        reportTier: 'pro',
    },
    team_monthly: {
        key: 'team_monthly',
        name: 'Team',
        amountPence: 9900,
        recurring: true,
        reportTier: 'pro',
    },
    agency_monthly: {
        key: 'agency_monthly',
        name: 'Agency',
        amountPence: 24900,
        recurring: true,
        reportTier: 'pro',
    },
};

function isManagedPostgresUrl(value) {
    try {
        const parsed = new URL(value);
        return ['postgres:', 'postgresql:'].includes(parsed.protocol)
            && Boolean(parsed.hostname)
            && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    }
    catch {
        return false;
    }
}
export function launchReadiness() {
    const checks = [
        { key: 'production_mode', label: 'NODE_ENV is production', ok: config.nodeEnv === 'production', required: false },
        { key: 'managed_postgres', label: 'Managed PostgreSQL DATABASE_URL configured', ok: isManagedPostgresUrl(config.databaseUrl), required: config.nodeEnv === 'production' },
        { key: 'secure_base_url', label: 'BASE_URL uses HTTPS', ok: config.baseUrl.startsWith('https://'), required: config.nodeEnv === 'production' },
        { key: 'session_secret', label: 'Strong session secret configured', ok: config.sessionSecret.length >= 32 && config.sessionSecret !== defaultSessionSecret, required: config.nodeEnv === 'production' },
        { key: 'live_payments', label: 'Demo payments disabled', ok: !config.demoMode, required: config.nodeEnv === 'production' && !config.allowDemoInProduction },
        { key: 'stripe_secret', label: 'Stripe secret configured', ok: Boolean(config.stripeSecretKey), required: !config.demoMode },
        { key: 'stripe_webhook', label: 'Stripe webhook secret configured', ok: Boolean(config.stripeWebhookSecret), required: !config.demoMode },
        { key: 'stripe_prices', label: 'All Stripe price IDs configured', ok: Object.values(config.stripePrices).every(Boolean), required: !config.demoMode },
        { key: 'email', label: 'Transactional email configured', ok: Boolean(config.resendApiKey) && !config.emailFrom.includes('example.com'), required: config.nodeEnv === 'production' },
        { key: 'admin', label: 'Owner analytics email configured', ok: Boolean(config.adminEmail), required: config.nodeEnv === 'production' },
        { key: 'support', label: 'Support email configured', ok: Boolean(config.supportEmail), required: config.nodeEnv === 'production' },
        { key: 'legal_identity', label: 'Legal operator identity configured', ok: Boolean(config.companyLegalName && config.companyAddress && config.legalJurisdiction), required: config.nodeEnv === 'production' },
        { key: 'metrics_auth', label: 'Protected production metrics token configured', ok: config.metricsToken.length >= 32, required: config.nodeEnv === 'production' },
    ];
    return {
        ready: checks.every((check) => !check.required || check.ok),
        checks,
    };
}
export function assertSafeProductionConfig() {
    const readiness = launchReadiness();
    if (config.nodeEnv !== 'production')
        return readiness;
    const failures = readiness.checks.filter((check) => check.required && !check.ok);
    if (failures.length) {
        throw new Error(`Unsafe production configuration: ${failures.map((check) => check.label).join('; ')}`);
    }
    return readiness;
}
