const story = document.querySelector('[data-policy-story]');
const check = story?.querySelector('[data-story-check]');
const decision = story?.querySelector('[data-story-decision]');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function runStory() {
  if (!story || !decision || !check) return;
  story.classList.remove('story-resolved');
  story.classList.add('story-checking');
  check.disabled = true;
  check.firstChild.textContent = 'Checking action ';
  window.setTimeout(() => {
    story.classList.remove('story-checking');
    story.classList.add('story-resolved');
    decision.innerHTML = '<small>Decision</small><strong>Blocked</strong><span>Exact human approval missing</span>';
    check.firstChild.textContent = 'Check again ';
    check.disabled = false;
  }, reduceMotion.matches ? 0 : 1100);
}

check?.addEventListener('click', runStory);

const reveals = [...document.querySelectorAll('.v10-home main > section, .evidence-signal li')];
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  document.documentElement.classList.add('reveal-enabled');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    }
  }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  reveals.forEach(node => observer.observe(node));
}
