import path from 'node:path';

const root = process.cwd();
const defaultSessionSecret = 'development-only-change-this-secret-before-deployment-123456';

export const config = {
  appVersion: '1.1.3',
  scoringVersion: 'arl-risk-v1.1',
  termsVersion: process.env.TERMS_VERSION || '2026-07-22',
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
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/agent-risk-layer.sqlite'),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeApiVersion: process.env.STRIPE_API_VERSION || '2026-06-24.dahlia',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'AgentRiskLayer <reports@example.com>',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  stripePrices: {
    basic_report: process.env.STRIPE_PRICE_BASIC_REPORT || '',
    pro_report: process.env.STRIPE_PRICE_PRO_REPORT || '',
    developer_monthly: process.env.STRIPE_PRICE_DEVELOPER_MONTHLY || '',
    agency_monthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY || '',
  },
};

export const plans = {
  basic_report: {
    key: 'basic_report',
    name: 'Essential report',
    amountPence: 999,
    recurring: false,
    reportTier: 'basic',
  },
  pro_report: {
    key: 'pro_report',
    name: 'Professional report',
    amountPence: 2499,
    recurring: false,
    reportTier: 'pro',
  },
  developer_monthly: {
    key: 'developer_monthly',
    name: 'Developer',
    amountPence: 1900,
    recurring: true,
    reportTier: 'pro',
  },
  agency_monthly: {
    key: 'agency_monthly',
    name: 'Agency',
    amountPence: 5900,
    recurring: true,
    reportTier: 'pro',
  },
};

export function launchReadiness() {
  const checks = [
    { key: 'production_mode', label: 'NODE_ENV is production', ok: config.nodeEnv === 'production', required: false },
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
  ];
  return {
    ready: checks.every((check) => !check.required || check.ok),
    checks,
  };
}

export function assertSafeProductionConfig() {
  const readiness = launchReadiness();
  if (config.nodeEnv !== 'production') return readiness;
  const failures = readiness.checks.filter((check) => check.required && !check.ok);
  if (failures.length) {
    throw new Error(`Unsafe production configuration: ${failures.map((check) => check.label).join('; ')}`);
  }
  return readiness;
}
