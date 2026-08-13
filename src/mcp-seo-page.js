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
  <title>MCP Server Risk Assessment & Security Testing | AgentRiskLayer</title>
  <meta name="description" content="Assess MCP server permissions, tool poisoning, prompt injection, OAuth scope, secrets, dynamic tool discovery, human approval, runtime controls and evidence.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="MCP Server Risk Assessment & Security Testing | AgentRiskLayer">
  <meta property="og:description" content="Review what an MCP server exposes, what can influence its tools, what actions an agent can take and what evidence proves the controls work.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/analytics.css">
  <script type="module" src="/shared.js"></script>
  <script type="module" src="/site-shell.js"></script>
</head>
<body class="v10-home" data-shell="public">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header site-header-v10" data-site-header>
    <a class="brand brand-v10" href="/" aria-label="AgentRiskLayer home"><span class="brand-mark">AR</span><span><strong>AgentRiskLayer</strong><small>AI agent security</small></span></a>
    <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="primaryNavigation"><span></span><span></span><span></span><span class="sr-only">Open menu</span></button>
    <nav id="primaryNavigation" class="primary-navigation" data-primary-navigation aria-label="Primary navigation">
      <a href="/index.html#product">Product</a><a href="/demo.html">See it work</a><a href="/pricing.html">Pricing</a><a href="/trust.html">Trust</a><a href="/help.html">Help</a>
      <a class="nav-signin" data-auth-link href="/auth.html">Sign in</a><a class="button primary small nav-primary-action" href="/assessment.html?type=MCP-enabled%20agent">Check an MCP agent free</a>
    </nav>
  </header>

  <main id="main-content">
    <section class="v10-hero">
      <div class="v10-hero-copy">
        <span class="eyebrow">MCP server security testing with evidence</span>
        <h1>MCP Server Risk Assessment</h1>
        <p class="hero-copy">Review what an MCP server exposes, which identities and data it can reach, how tool output can influence an agent, what actions can execute, and what evidence supports a deployment decision.</p>
        <div class="button-row">
          <a class="button primary button-xl" href="/assessment.html?type=MCP-enabled%20agent">Start the free MCP agent check <span aria-hidden="true">→</span></a>
          <a class="button ghost button-xl" href="/sample-report.html">See an example report</a>
        </div>
        <div class="v10-proof-line" aria-label="Assessment principles">
          <span><b>Version-bound</b> assessment and retest evidence</span>
          <span><b>Unknown is not a finding</b></span>
          <span><b>Observed failure</b> required for a finding</span>
        </div>
      </div>

      <aside class="v10-control-visual" aria-label="MCP server security evidence chain">
        <div class="visual-topbar"><span>MCP security review</span><span class="live-state"><i></i> Evidence first</span></div>
        <div class="visual-flow">
          <div class="visual-node"><small>Server + tools</small><strong>Identity, schemas, data</strong><span>Declared capability and trust boundary</span></div>
          <div class="visual-arrow" aria-hidden="true">→</div>
          <div class="visual-gate"><span class="brand-mark">AR</span><small>Assessment</small><strong>Test access + actions</strong></div>
          <div class="visual-arrow" aria-hidden="true">→</div>
          <div class="visual-node blocked"><small>Decision</small><strong>Evidence required</strong><span>Fix, exact retest, then decide</span></div>
        </div>
        <div class="visual-evidence">
          <span><i>✓</i> Declarations stay separate from observed evidence</span>
          <span><i>✓</i> Tool and authorization boundaries are tested explicitly</span>
          <span><i>✓</i> Remediation closes only after exact retest</span>
        </div>
      </aside>
    </section>

    <section class="v10-audience-strip" aria-label="MCP server assessment use cases">
      <span>Useful before connecting an MCP server to a real agent or expanding its authority</span>
      <b>Remote MCP</b><b>Local MCP</b><b>Dynamic tools</b><b>Customer data</b><b>High-impact actions</b>
    </section>

    <section class="content-section v10-problem-section">
      <div class="section-heading v10-split-heading">
        <div><span class="eyebrow">What server risk testing should answer</span><h2>Connecting successfully is not the same as being controlled.</h2></div>
        <p>An MCP server can sit across identity, authorization, tool discovery, untrusted tool output, secrets, external APIs and privileged actions. The assessment binds those capabilities to the exact server and agent version being reviewed.</p>
      </div>
      <div class="v10-question-grid">
        <article><span>01</span><h3>Server trust</h3><p>Who operates the server, how is its version or origin established, and can a package, marketplace entry or dependency change what the agent trusts?</p></article>
        <article><span>02</span><h3>Authorization</h3><p>Are tokens intended for this server, are scopes minimal, are credentials isolated by issuer and environment, and can one identity cross a tenant or resource boundary?</p></article>
        <article><span>03</span><h3>Tool influence</h3><p>Can tool descriptions, schemas, dynamic discovery or tool output place untrusted instructions into the model context and influence another privileged tool call?</p></article>
        <article><span>04</span><h3>Action authority</h3><p>Can the agent write, delete, deploy, refund, message, change permissions or trigger downstream side effects without an exact policy or human approval boundary?</p></article>
      </div>
    </section>

    <section class="v10-product-band">
      <div class="content-section">
        <div class="section-heading v10-split-heading">
          <div><span class="eyebrow">MCP risk assessment coverage</span><h2>Test the boundaries that change what the server can cause.</h2></div>
          <p>Controls are evaluated in context. A risky capability can make a control applicable, but it does not become a vulnerability until an observed or reproducible failure supports a finding.</p>
        </div>
        <div class="v10-capability-grid">
          <article class="capability-card"><div class="capability-icon">1</div><div><small>PROVENANCE</small><h3>Server, package and dependency trust</h3><p>Record the server identity, deployment origin, package or image version, external dependencies and how changes are detected before they reach the agent.</p></div></article>
          <article class="capability-card"><div class="capability-icon">2</div><div><small>AUTH</small><h3>OAuth, audience and scope</h3><p>Review resource and audience binding, issuer validation, token storage, redirect handling, least-privilege scopes and separation between MCP and upstream API credentials.</p></div></article>
          <article class="capability-card"><div class="capability-icon">3</div><div><small>TOOLS</small><h3>Tool schemas and dynamic discovery</h3><p>Check whether newly discovered or changed tools can expand authority silently, whether descriptions are treated as untrusted, and whether schemas constrain inputs and outputs.</p></div></article>
          <article class="capability-card"><div class="capability-icon">4</div><div><small>INJECTION</small><h3>Tool poisoning and prompt injection</h3><p>Use authorised tests to see whether malicious or compromised tool output can steer the model toward restricted data, another tool or an unsafe action.</p></div></article>
          <article class="capability-card"><div class="capability-icon">5</div><div><small>SECRETS</small><h3>Credentials and data exposure</h3><p>Review environment secrets, logs, tool arguments, returned content, file and network access, tenant boundaries and whether sensitive values can escape through tool calls.</p></div></article>
          <article class="capability-card"><div class="capability-icon">6</div><div><small>APPROVAL</small><h3>High-impact action integrity</h3><p>For consequential actions, check that approval is bound to the exact tool, target, parameters, value and validity period and cannot be replayed after the approved action changes.</p></div></article>
          <article class="capability-card"><div class="capability-icon">7</div><div><small>RUNTIME</small><h3>Server-side enforcement</h3><p>Verify that restrictions are enforced at the tool or policy boundary rather than relying only on model instructions, and that runtime decisions create reviewable evidence.</p></div></article>
          <article class="capability-card"><div class="capability-icon">8</div><div><small>RETEST</small><h3>Remediation and exact retest</h3><p>Record the fix against the changed system version, rerun the original failure condition and preserve the result before a finding is closed or deployment advice changes.</p></div></article>
        </div>
      </div>
    </section>

    <section class="content-section v10-how-section">
      <div class="section-heading vertical">
        <span class="eyebrow">Evidence model</span>
        <h2>What proves an MCP risk is controlled?</h2>
        <p>AgentRiskLayer separates what the owner says is configured from what inspection, controlled testing and runtime records actually demonstrate.</p>
      </div>
      <ol class="v10-journey">
        <li><span>1</span><div><small>DECLARE</small><h3>Exact server and agent scope</h3><p>Identify the server, protocol implementation, agent version, tools, identities, data, external services, network reach and approval model.</p></div></li>
        <li><span>2</span><div><small>OBSERVE</small><h3>Inspect the implemented boundaries</h3><p>Collect relevant configuration, tool definitions, authorization behavior, policy enforcement and privacy-safe evidence without treating claims as proof.</p></div></li>
        <li><span>3</span><div><small>TEST</small><h3>Run authorised failure tests</h3><p>Exercise defined scenarios for tool poisoning, prompt injection, privilege misuse, token or tenant boundary failures and high-impact action controls.</p></div></li>
        <li><span>4</span><div><small>DECIDE</small><h3>Finding, fix, retest, decision</h3><p>Create a finding only when the failure is observed or reproducible. Record remediation, rerun the exact test and use current evidence for proceed, hold or do-not-deploy decision support.</p></div></li>
      </ol>
    </section>

    <section class="v10-example-band">
      <div class="content-section v10-example-layout">
        <div>
          <span class="eyebrow">Example MCP attack path</span>
          <h2>A harmless-looking tool response tells the agent to call a privileged internal tool.</h2>
          <p>The security question is not whether the text looks malicious. It is whether untrusted tool output can cross a trust boundary and cause a privileged action. A controlled system should constrain tool responses where practical, isolate privileged actions, enforce permissions outside the model and require exact approval where impact warrants it.</p>
          <div class="button-row"><a class="button primary" href="/assessment.html?type=MCP-enabled%20agent">Assess an MCP-enabled agent</a><a class="button ghost" href="/runtime.html">Review runtime controls</a></div>
        </div>
        <div class="v10-example-result">
          <span class="example-label">Evidence rule</span>
          <strong>FAILURE BEFORE FINDING</strong>
          <p>Potential attack path → applicable control → authorised test → observed result.</p>
          <dl><div><dt>Tool output untrusted?</dt><dd>Control applies</dd></div><div><dt>Exploit not reproduced?</dt><dd>No finding yet</dd></div><div><dt>Failure reproduced?</dt><dd>Finding + remediation</dd></div></dl>
        </div>
      </div>
    </section>

    <section class="content-section">
      <div class="section-heading v10-split-heading">
        <div><span class="eyebrow">Current MCP security context</span><h2>Bind the review to the protocol behavior you actually run.</h2></div>
        <p>The MCP 2026-07-28 release moved the protocol core to stateless requests and added authorization hardening. Assessments should record the implementation and version in scope rather than assume all MCP clients and servers behave the same way.</p>
      </div>
      <div class="v10-question-grid">
        <article><h3>Stateless requests</h3><p>Current MCP requests can carry protocol, method, tool and client information per request. Gateways can therefore apply routing, authorization and metering to self-describing requests rather than depending on a protocol session.</p></article>
        <article><h3>Authorization hardening</h3><p>Review issuer validation, credential isolation, resource and audience binding, step-up scope behavior and the exact authorization flow implemented by the client and server.</p></article>
        <article><h3>Official security guidance</h3><p>Use the <a href="https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices">MCP Security Best Practices</a> and the current <a href="https://blog.modelcontextprotocol.io/posts/2026-07-28/">MCP specification release notes</a> as protocol references.</p></article>
        <article><h3>Known attack pattern</h3><p>OWASP documents <a href="https://owasp.org/www-community/attacks/MCP_Tool_Poisoning">MCP Tool Poisoning</a>, where malicious tool responses can inject instructions into an agent context and attempt to reach more privileged tools or data.</p></article>
      </div>
    </section>

    <section class="content-section v10-pricing-preview">
      <div class="section-heading v10-split-heading">
        <div><span class="eyebrow">From free check to evidence</span><h2>Start with the MCP agent you actually plan to deploy.</h2></div>
        <p>The free check qualifies the architecture and missing evidence. The one-off AI Agent Security Assessment unlocks the full report and customer-operated evidence, controlled-testing, remediation and retest workflows; only completed work is reported as performed.</p>
      </div>
      <div class="v10-price-grid">
        <article><small>QUALIFY</small><h3>Free agent check</h3><strong>£0</strong><p>Describe the MCP server, agent, tools, permissions and safeguards and get an initial risk view.</p><a class="button ghost full" href="/assessment.html?type=MCP-enabled%20agent">Start free</a></article>
        <article class="recommended"><small>ASSESS</small><h3>AI Agent Security Assessment</h3><strong>£99 <em>once</em></strong><p>Full report and PDF plus evidence, controlled-testing, remediation and exact-retest workflows for one agent.</p><a class="button primary full" href="/assessment.html?type=MCP-enabled%20agent">Start with the free check</a></article>
        <article><small>OPERATE</small><h3>Runtime protection</h3><strong>From £29 <em>/month</em></strong><p>Ongoing runtime decisions, approvals, evidence retention and project workflows.</p><a class="button ghost full" href="/pricing.html">Compare plans</a></article>
      </div>
    </section>

    <section class="content-section">
      <div class="section-heading vertical"><span class="eyebrow">MCP security assessment FAQ</span><h2>Questions before you connect a server to an agent</h2></div>
      <div class="v10-question-grid">
        <article><h3>Is every MCP server automatically high risk?</h3><p>No. Risk depends on the server's permissions, data, tools, external dependencies, agent authority and implemented controls. Capability alone is not a finding.</p></article>
        <article><h3>Does missing MCP information become a vulnerability?</h3><p>No. Unknown, missing or inconclusive information remains an information gap. A finding requires an observed or reproducible failure.</p></article>
        <article><h3>Can you test tool poisoning?</h3><p>Where the owner authorises the scenario and the environment is appropriate, controlled testing can check whether untrusted tool content can influence restricted actions. Production destructive testing is not implied.</p></article>
        <article><h3>What should be tested around OAuth?</h3><p>Relevant tests can cover token audience and resource binding, issuer validation, scope boundaries, redirect handling, secret storage and separation between MCP credentials and upstream service credentials.</p></article>
        <article><h3>What evidence is useful?</h3><p>Useful evidence can include versioned tool definitions, policy configuration, authorization behavior, inspection output, controlled test results, runtime decisions, human approvals and exact retest records.</p></article>
        <article><h3>Is this an MCP certification?</h3><p>No. AgentRiskLayer Security Assessment is a proprietary assessment against the AgentRiskLayer Control Profile. It is not an accredited certification or a guarantee that a system is risk-free.</p></article>
      </div>
    </section>

    <section class="content-section v10-final-cta">
      <div><span class="eyebrow">Assess one real MCP integration</span><h2>Find out what the server can expose, what the agent can do and what evidence is still missing.</h2><p>Start free. Findings require observed or reproducible failure evidence.</p></div>
      <a class="button primary button-xl" href="/assessment.html?type=MCP-enabled%20agent">Start the MCP server risk assessment <span aria-hidden="true">→</span></a>
    </section>
  </main>

  <footer class="site-footer-v10"><div class="footer-grid"><div class="footer-brand"><a class="brand brand-v10" href="/"><span class="brand-mark">AR</span><span><strong>AgentRiskLayer</strong><small>Evidence. Control. Trust.</small></span></a><p>Understand what an AI agent can access, stop unsafe actions and keep evidence for accountable decisions.</p></div><div><strong>Product</strong><a href="/assessment.html">Check an agent</a><a href="/ai-agent-security-assessment.html">AI agent security assessment</a><a href="/checks/mcp-server-risk-assessment">MCP server risk assessment</a><a href="/runtime.html">Runtime protection</a><a href="/pricing.html">Pricing</a></div><div><strong>Trust</strong><a href="/trust.html">Trust Centre</a><a href="/security-center.html">Security controls</a><a href="/methodology.html">Methodology</a><a href="/sample-report.html">Sample report</a></div><div><strong>Company</strong><a href="/company.html">About</a><a href="/help.html">Help Centre</a><a href="mailto:support@agentrisklayer.com">Contact support</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div></div><div class="footer-bottom"><span>© 2026 AgentRiskLayer</span><span>This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.</span></div></footer>
</body>
</html>`;
}
