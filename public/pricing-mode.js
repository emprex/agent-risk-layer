export function resolvePricingMode(config = {}) {
  const productStage = String(config.productStage || '').trim().toLowerCase();
  const demoMode = config.demoMode === true;
  if (productStage === 'production' && demoMode) {
    return {
      mode: 'production_billing_blocked',
      allowCheckout: false,
      showDemoNotice: false,
      message: 'Production checkout is temporarily unavailable because the live payment configuration is inconsistent. AgentRiskLayer will not simulate a payment on the production service.',
    };
  }
  if (demoMode) {
    return {
      mode: 'demo',
      allowCheckout: false,
      showDemoNotice: true,
      message: 'This non-production environment does not process live payments. Checkout is disabled here.',
    };
  }
  return {
    mode: 'live',
    allowCheckout: true,
    showDemoNotice: false,
    message: '',
  };
}
