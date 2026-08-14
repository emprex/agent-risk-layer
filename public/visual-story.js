const story = document.querySelector('[data-policy-story]');
const check = story?.querySelector('[data-story-check]');
const decision = story?.querySelector('[data-story-decision]');
const evidence = story?.querySelector('[data-story-evidence]');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function runStory() {
  if (!story || !decision || !check) return;
  story.classList.remove('story-resolved');
  story.classList.add('story-checking');
  check.disabled = true;
  check.firstChild.textContent = 'Checking… ';
  decision.innerHTML = '<small>Decision</small><strong>Checking policy</strong><span>Approval and context are being verified</span>';
  evidence?.setAttribute('aria-busy', 'true');

  window.setTimeout(() => {
    story.classList.remove('story-checking');
    story.classList.add('story-resolved');
    decision.innerHTML = '<small>Decision</small><strong>Blocked</strong><span>No exact human approval matches this action</span>';
    check.firstChild.textContent = 'Run again ';
    check.disabled = false;
    evidence?.setAttribute('aria-busy', 'false');
  }, reduceMotion.matches ? 0 : 320);
}

check?.addEventListener('click', runStory);
