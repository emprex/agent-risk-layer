import path from 'node:path';
import { isIP } from 'node:net';
import { BILLABLE_PLANS } from './commercial-catalogue.js';
import './questionnaire-applicability.js';
const root = process.cwd();
const defaultSessionSecret = 'development-only-change-this-secret-before-deployment-123456';
export const defaultBindHost = '0.0.0.0';
const resolvedNodeEnv = process.env.NODE_ENV || 'development';
const resolvedProductStage = process.env.PRODUCT_STAGE || (resolvedNodeEnv === 'production' ? 'production' : 'development');

function looksLikeNumericAddress(value) {
    const numericComponent = /^(?:[0-9]+|0[xX][0-9A-Fa-f]+)$/;
    const components = value.split('.');
    return numericComponent.test(value)
        || (components.length > 1 && components.every((component) => numericComponent.test(component)));
}

export function parseBindHost(value) {
    if (value === undefined)
        return defaultBindHost;
    if (typeof value !== 'string' || !value.length)
        throw new Error('Invalid HOST: expected an IP address or DNS hostname');
    if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value))
        throw new Error('Invalid HOST: whitespace and control characters are not permitted');
    if (isIP(value))
        return value;
    if (looksLikeNumericAddress(value))
        throw new Error('Invalid HOST: noncanonical numeric address syntax is not permitted');
    if (value.includes('://') || /[/\\@?#:[\]]/.test(value))
        throw new Error('Invalid HOST: URL, path, credential and port syntax are not permitted');
    if (value.length > 253 || value.endsWith('.'))
        throw new Error('Invalid HOST: malformed DNS hostname');
    const labels = value.split('.');
    if (labels.some((label) => !label.length
        || label.length > 63
        || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)))
        throw new Error('Invalid HOST: malformed DNS hostname');
    return value;
}

export const config = {
    appVersion: '10.1.1',
    scoringVersion: 'arl-risk-v3.4',
    termsVersion: process.env.TERMS_VERSION || '2026-07-22',
    productStage: resolvedProductStage,
    companyName: process.env.COMPANY_NAME || 'AgentRiskLayer',
    companyLegalName: (process.env.COMPANY_LEGAL_NAME || '').trim(),
    companyAddress: (process.env.COMPANY_ADDRESS || '').trim(),
    legalJurisdiction: (process.env.LEGAL_JURISDICTION || '').trim(),
    supportEmail: (process.env.SUPPORT_EMAIL || '').trim().toLowerCase(),
    port: Number(process.env.PORT || 3000),
    host: parseBindHost(process.env.HOST),
    baseUrl: String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    nodeEnv: resolvedNodeEnv,
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
    billingWebhookMode: String(process.env.BILLING_WEBHOOK_MODE || 'enabled').trim().toLowerCase(),
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
        pro_report: (process.env.STRIPE_PRICE_PRO_REPORT || '').trim(),
        developer_monthly: (process.env.STRIPE_PRICE_DEVELOPER_MONTHLY || '').trim(),
        team_monthly: (process.env.STRIPE_PRICE_TEAM_MONTHLY || '').trim(),
        agency_monthly: (process.env.STRIPE_PRICE_AGENCY_MONTHLY || '').trim(),
    },
};
export const plans = BILLABLE_PLANS;

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
    const productionStage = config.productStage === 'production';
    const checks = [
        { key: 'production_mode', label: 'NODE_ENV is production', ok: config.nodeEnv === 'production', required: productionStage },
        { key: 'managed_postgres', label: 'Managed PostgreSQL DATABASE_URL configured', ok: isManagedPostgresUrl(config.databaseUrl), required: productionStage },
        { key: 'secure_base_url', label: 'BASE_URL uses HTTPS', ok: config.baseUrl.startsWith('https://'), required: productionStage },
        { key: 'session_secret', label: 'Strong session secret configured', ok: config.sessionSecret.length >= 32 && config.sessionSecret !== defaultSessionSecret, required: productionStage },
        { key: 'live_payments', label: 'Demo payments disabled', ok: !config.demoMode, required: productionStage && !config.allowDemoInProduction },
        { key: 'stripe_secret', label: 'Stripe secret configured', ok: Boolean(config.stripeSecretKey), required: !config.demoMode },
        { key: 'stripe_webhook', label: 'Stripe webhook secret configured', ok: Boolean(config.stripeWebhookSecret), required: !config.demoMode },
        { key: 'billing_webhook_mode', label: 'Billing webhook mode is explicit', ok: ['enabled','maintenance'].includes(config.billingWebhookMode), required: productionStage },
        { key: 'stripe_prices', label: 'All Stripe price IDs configured', ok: Object.values(config.stripePrices).every(Boolean), required: !config.demoMode },
        { key: 'email', label: 'Transactional email configured', ok: Boolean(config.resendApiKey) && !config.emailFrom.includes('example.com'), required: productionStage },
        { key: 'admin', label: 'Owner analytics email configured', ok: Boolean(config.adminEmail), required: productionStage },
        { key: 'support', label: 'Support email configured', ok: Boolean(config.supportEmail), required: productionStage },
        { key: 'legal_identity', label: 'Legal operator identity configured', ok: Boolean(config.companyLegalName && config.companyAddress && config.legalJurisdiction), required: productionStage },
        { key: 'metrics_auth', label: 'Protected production metrics token configured', ok: config.metricsToken.length >= 32, required: productionStage },
    ];
    return {
        ready: checks.every((check) => !check.required || check.ok),
        checks,
    };
}
export function assertSafeProductionConfig() {
    const readiness = launchReadiness();
    if (config.productStage !== 'production')
        return readiness;
    const failures = readiness.checks.filter((check) => check.required && !check.ok);
    if (failures.length) {
        throw new Error(`Unsafe production configuration: ${failures.map((check) => check.label).join('; ')}`);
    }
    return readiness;
}
