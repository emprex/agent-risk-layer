import { hydrateNav } from './shared.js';

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-primary-navigation]');

function normalisePath(value) {
  try {
    const url = new URL(value, location.origin);
    return url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function markCurrentNavigation() {
  const current = normalisePath(location.pathname);
  document.querySelectorAll('[data-primary-navigation] a[href], [data-local-navigation] a[href]').forEach((link) => {
    const target = normalisePath(link.getAttribute('href'));
    const match = target && (target === current || (target !== '/' && current.startsWith(target.replace(/\.html$/, ''))));
    if (match) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function setMenu(open, { focus = false } = {}) {
  if (!header || !menuButton || !navigation) return;
  header.classList.toggle('menu-open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('site-menu-open', open);
  if (focus && open) navigation.querySelector('a, button')?.focus();
}

menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true', { focus: true }));
navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && header?.classList.contains('menu-open')) {
    setMenu(false);
    menuButton?.focus();
  }
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) setMenu(false);
});

markCurrentNavigation();

hydrateNav().catch(() => null);
