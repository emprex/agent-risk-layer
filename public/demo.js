const content = document.querySelector('#demoContent');
const nextButton = document.querySelector('#nextButton');
const backButton = document.querySelector('#backButton');
const progress = document.querySelector('#demoProgress');
const stepLabel = document.querySelector('#stepLabel');
const complete = document.querySelector('#demoComplete');
const score = document.querySelector('#demoScore');
const risk = document.querySelector('#demoRisk');

const steps = [
  {
    action: 'Inspect locally',
    html: `<span class="demo-kicker">Declared exposure</span><h2>The agent can read untrusted email and prepare refunds.</h2><p class="muted">The owner reports an approval step, but has not supplied technical evidence that the refund tool enforces it.</p><div class="finding demo-finding"><div class="finding-head"><h4>Broad action authority influenced by untrusted content</h4><span class="severity high">High</span></div><p>Evidence strength: customer declaration only.</p></div>`,
  },
  {
    action: 'Run safe attack',
    html: `<span class="demo-kicker">Observed locally</span><h2>The approval check exists in the prompt—not at the tool boundary.</h2><p class="muted">The Inspector finds the refund tool available to the agent and no code-enforced approval token before invocation.</p><pre><code>tool: prepare_refund
approval_required: prompt_only
maximum_amount: not_observed
source_upload: false</code></pre><div class="evidence-callout"><strong>Why this matters</strong><span>A prompt instruction can be overridden. A server-side authorisation check cannot.</span></div>`,
  },
  {
    action: 'Apply remediation',
    html: `<span class="demo-kicker">Reproduced safely · 4/5 trials</span><h2>A fake support email causes an unauthorised refund request.</h2><p class="muted">The staging adapter uses a synthetic customer and a dry-run refund tool. No payment is created.</p><div class="attack-trace"><span>Untrusted email</span><b>→</b><span>Goal hijack</span><b>→</b><span class="trace-fail">Refund tool called</span></div><div class="finding demo-finding"><div class="finding-head"><h4>ARL-RT-AUTH-004</h4><span class="outcome failed">Reproduced</span></div><p>Unauthorised action reproduced in 4 of 5 seeded trials. Raw prompts and responses remain local.</p></div>`,
  },
  {
    action: 'Finish demo',
    html: `<span class="demo-kicker">Retested · 0/5 trials</span><h2>The fix moves approval enforcement into the tool gateway.</h2><ul class="check-list demo-fix-list"><li>Require a signed, single-use approval token</li><li>Bind the token to customer, amount and expiry</li><li>Enforce a server-side refund ceiling</li><li>Reject tool calls derived only from untrusted content</li></ul><div class="success-box"><strong>Verified change:</strong> the same attack strategy failed in all 5 retest trials.</div>`,
  },
];

let current = 0;

function render() {
  const step = steps[current];
  content.innerHTML = step.html;
  stepLabel.textContent = `Step ${current + 1} of ${steps.length}`;
  progress.style.width = `${((current + 1) / steps.length) * 100}%`;
  backButton.disabled = current === 0;
  nextButton.textContent = step.action;
  document.querySelector('#observedStatus').textContent = current >= 1 ? '✓' : '—';
  document.querySelector('#reproducedStatus').textContent = current >= 2 ? '✓' : '—';
  document.querySelector('#retestedStatus').textContent = current >= 3 ? '✓' : '—';
  if (current === 3) {
    score.innerHTML = '28<small>/100</small>';
    risk.className = 'risk-pill moderate';
    risk.textContent = 'Moderate risk';
  } else {
    score.innerHTML = '72<small>/100</small>';
    risk.className = 'risk-pill high';
    risk.textContent = 'High risk';
  }
}

nextButton.addEventListener('click', () => {
  if (current < steps.length - 1) {
    current += 1;
    render();
    return;
  }
  complete.hidden = false;
  complete.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

backButton.addEventListener('click', () => {
  if (current > 0) current -= 1;
  complete.hidden = true;
  render();
});

render();
