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
      allowCheckout: true,
      showDemoNotice: true,
      message: 'Demo mode is active. Subscription checkout is simulated and can be cancelled from the dashboard.',
    };
  }
  return {
    mode: 'live',
    allowCheckout: true,
    showDemoNotice: false,
    message: '',
  };
}
