function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function renderMcpServerRiskAssessmentPage(baseUrl) {
  const origin = escapeHtml(String(baseUrl || 'https://agentrisklayer.com').replace(/\/+$/, ''));
  const canonical = `${origin}/checks/mcp-server-risk-assessment`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MCP Server Security Assessment | AgentRiskLayer</title>
  <meta name="description" content="Human-led MCP and AI agent security assessment covering tool trust, permissions, evidence, authorised testing, remediation and exact retesting.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/marketing.css">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="marketing-header">
    <a class="brand" href="/">AgentRiskLayer</a>
    <nav class="marketing-nav" aria-label="Main navigation">
      <a href="/ai-agent-security-assessment.html">Assessment</a>
      <a href="/pricing.html">Pricing</a>
      <a href="/sample-report.html">Example report</a>
      <a class="nav-cta" href="/request-assessment.html">Request an Assessment</a>
    </nav>
  </header>
  <main id="main-content">
    <section class="page-hero narrow">
      <p class="eyebrow">MCP / tool-using agents</p>
      <h1>Assess the security boundaries around your MCP-enabled agent.</h1>
      <p class="lede">We review tool trust, permissions, untrusted inputs, credentials, approval boundaries and high-impact actions, then connect findings to evidence, remediation and exact retesting.</p>
      <div class="actions">
        <a class="button primary" href="/request-assessment.html">Request an Assessment</a>
        <a class="button secondary" href="/sample-report.html">See an example report</a>
      </div>
    </section>
    <section class="section narrow">
      <div class="note">
        <h2>What the assessment covers</h2>
        <p>Server and tool provenance, authentication and authorization, tool schemas and dynamic discovery, prompt injection and tool poisoning paths, secrets and data exposure, human approval, runtime enforcement, remediation and exact retesting.</p>
        <h2>Evidence before conclusions</h2>
        <p>Declared capability is not treated as proof. A finding requires authoritative ARL evidence, and closure requires verified retest evidence. The final accountable deployment decision remains human.</p>
        <h2>Engagement model</h2>
        <p>This is a human-led security assessment, not an automated free scan or browser checkout. MCP and tool-using assessments start from £5,000, with scope and price agreed before testing.</p>
      </div>
    </section>
  </main>
  <footer class="marketing-footer">
    <div><strong>AgentRiskLayer</strong><span>AI agent security assessment before production.</span></div>
    <nav aria-label="Footer navigation">
      <a href="/trust.html">Trust</a>
      <a href="/company.html">Company</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/legal/terms.html">Terms</a>
    </nav>
  </footer>
</body>
</html>`;
}
