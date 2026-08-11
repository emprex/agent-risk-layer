const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setupReveal() {
  const nodes = [...document.querySelectorAll('[data-reveal]')];
  if (!nodes.length) return;
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    nodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
  nodes.forEach((node) => observer.observe(node));
}

function setupQuestionBand() {
  const root = document.querySelector('[data-question-band]');
  if (!root) return;
  const lines = [...root.querySelectorAll('[data-question-line]')];
  if (!lines.length) return;
  if (reducedMotion.matches) {
    lines.forEach((line) => line.classList.add('is-active'));
    return;
  }
  let timer = null;
  let index = 0;
  const activate = () => {
    lines.forEach((line, i) => line.classList.toggle('is-active', i === index));
    index = (index + 1) % lines.length;
  };
  const start = () => {
    if (timer) return;
    activate();
    timer = window.setInterval(activate, 1800);
  };
  const stop = () => {
    window.clearInterval(timer);
    timer = null;
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) start();
      else stop();
    }, { threshold: 0.35 });
    observer.observe(root);
  } else start();
  window.addEventListener('pagehide', stop, { once: true });
}

function setupAuthorityDemo() {
  const root = document.querySelector('[data-authority-demo]');
  if (!root) return;
  const decision = root.querySelector('[data-authority-decision]');
  const scenes = [
    ['0', 'OBSERVING AUTHORITY'],
    ['1', 'UNSAFE PATH DETECTED'],
    ['2', 'EXACT APPROVAL REQUIRED'],
    ['3', 'EVIDENCE RECORDED'],
  ];
  let index = 0;
  let timer = null;
  const render = () => {
    const [scene, label] = scenes[index];
    root.dataset.scene = scene;
    if (decision) decision.textContent = label;
    index = (index + 1) % scenes.length;
  };
  if (reducedMotion.matches) {
    root.dataset.scene = '3';
    if (decision) decision.textContent = 'EVIDENCE RECORDED';
    return;
  }
  const start = () => {
    if (timer) return;
    render();
    timer = window.setInterval(render, 2600);
  };
  const stop = () => {
    window.clearInterval(timer);
    timer = null;
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) start();
      else stop();
    }, { threshold: 0.25 });
    observer.observe(root);
  } else start();
  window.addEventListener('pagehide', stop, { once: true });
}

function setupEvidenceChain() {
  const root = document.querySelector('[data-evidence-chain]');
  if (!root) return;
  const steps = [...root.querySelectorAll('[data-chain-step]')];
  const progress = root.querySelector('[data-chain-progress]');
  if (!steps.length) return;
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    steps.forEach((step) => step.classList.add('is-active'));
    if (progress) progress.style.width = '90%';
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = steps.indexOf(entry.target);
      if (index < 0) return;
      for (let i = 0; i <= index; i += 1) steps[i].classList.add('is-active');
      if (progress) progress.style.width = `${Math.min(90, 5 + (index / Math.max(steps.length - 1, 1)) * 85)}%`;
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.45 });
  steps.forEach((step) => observer.observe(step));
}

const productCopy = {
  assess: ['Assessment', 'Start with the agent’s purpose, access, tools, approvals and recovery. The result identifies what needs deeper evidence.'],
  inspect: ['Observed controls', 'Compare declared controls with code, configuration and local evidence without treating customer statements as verification.'],
  test: ['Controlled testing', 'Run authorised, bounded tests that reproduce the exact security property under review.'],
  find: ['Finding', 'Record the observed weakness, affected system version, severity reasoning and evidence source.'],
  remediate: ['Remediation', 'Assign the fix, implementation evidence, changed system snapshot and rollback/validation plan.'],
  retest: ['Exact retest', 'Challenge the changed system with the same failure and reasonable bypass variants.'],
  decide: ['Deployment decision', 'Proceed, hold or do not deploy based on the current evidence chain and unresolved blockers.'],
};

function setupProductTour() {
  const root = document.querySelector('[data-product-tour]');
  if (!root) return;
  const buttons = [...root.querySelectorAll('[data-product-tab]')];
  const title = root.querySelector('[data-product-title]');
  const copy = root.querySelector('[data-product-copy]');
  const rows = [...root.querySelectorAll('[data-product-row]')];
  if (!buttons.length) return;
  const activate = (button) => {
    buttons.forEach((item) => item.setAttribute('aria-selected', String(item === button)));
    const key = button.dataset.productTab;
    const [nextTitle, nextCopy] = productCopy[key] || productCopy.assess;
    if (title) title.textContent = nextTitle;
    if (copy) copy.textContent = nextCopy;
    rows.forEach((row, index) => {
      row.classList.remove('success', 'warning', 'critical');
      const state = index < 2 ? 'success' : index === 2 ? 'warning' : 'critical';
      if (['assess', 'inspect'].includes(key) && index === 3) return;
      if (key === 'decide' && index < 3) row.classList.add('success');
      else row.classList.add(state);
    });
  };
  buttons.forEach((button) => button.addEventListener('click', () => activate(button)));
  activate(buttons[0]);
}

function setupResourceMenus() {
  document.addEventListener('click', (event) => {
    document.querySelectorAll('details.v2-resources[open]').forEach((details) => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details.v2-resources[open]').forEach((details) => {
      details.removeAttribute('open');
      details.querySelector('summary')?.focus();
    });
  });
}

function boot() {
  document.documentElement.dataset.websiteV2 = 'ready';
  setupReveal();
  setupQuestionBand();
  setupAuthorityDemo();
  setupEvidenceChain();
  setupProductTour();
  setupResourceMenus();
}

boot();
