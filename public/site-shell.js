import { hydrateNav } from './shared.js';

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-primary-navigation]');
const mobileNavigation = window.matchMedia('(max-width: 900px)');
let lastFocusedElement = null;

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

function menuLabel(open) {
  return open ? 'Close menu' : 'Open menu';
}

function setNavigationAvailability(open) {
  if (!navigation) return;
  const hiddenOnMobile = mobileNavigation.matches && !open;
  navigation.setAttribute('aria-hidden', String(hiddenOnMobile));
  navigation.toggleAttribute('inert', hiddenOnMobile);
}

function createMenuScrim() {
  if (!header || document.querySelector('[data-menu-scrim]')) return document.querySelector('[data-menu-scrim]');
  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'menu-scrim';
  scrim.dataset.menuScrim = '';
  scrim.tabIndex = -1;
  scrim.setAttribute('aria-label', 'Close navigation menu');
  scrim.setAttribute('aria-hidden', 'true');
  header.insertAdjacentElement('afterend', scrim);
  return scrim;
}

const menuScrim = createMenuScrim();

function setMenu(open, { focus = false, restoreFocus = false } = {}) {
  if (!header || !menuButton || !navigation) return;
  const nextOpen = Boolean(open && mobileNavigation.matches);

  if (nextOpen && !header.classList.contains('menu-open')) {
    lastFocusedElement = document.activeElement;
  }

  header.classList.toggle('menu-open', nextOpen);
  menuButton.setAttribute('aria-expanded', String(nextOpen));
  menuButton.setAttribute('aria-label', menuLabel(nextOpen));
  const label = menuButton.querySelector('.sr-only');
  if (label) label.textContent = menuLabel(nextOpen);
  document.body.classList.toggle('site-menu-open', nextOpen);
  menuScrim?.setAttribute('aria-hidden', String(!nextOpen));
  setNavigationAvailability(nextOpen);

  if (focus && nextOpen) {
    requestAnimationFrame(() => navigation.querySelector('a[href], button:not([disabled])')?.focus());
  }

  if (restoreFocus && !nextOpen) {
    const target = lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)
      ? lastFocusedElement
      : menuButton;
    target.focus();
  }
}

function focusableMenuControls() {
  if (!header) return [];
  return [...header.querySelectorAll('button:not([disabled]), a[href]')]
    .filter((element) => !element.hasAttribute('inert'));
}

menuButton?.setAttribute('aria-label', menuLabel(false));
menuButton?.addEventListener('click', () => {
  setMenu(menuButton.getAttribute('aria-expanded') !== 'true', { focus: true, restoreFocus: true });
});

menuScrim?.addEventListener('click', () => setMenu(false, { restoreFocus: true }));

navigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (!header?.classList.contains('menu-open')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    setMenu(false, { restoreFocus: true });
    return;
  }

  if (event.key !== 'Tab') return;
  const controls = focusableMenuControls();
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function syncNavigationForViewport() {
  if (!mobileNavigation.matches) {
    setMenu(false);
    navigation?.removeAttribute('aria-hidden');
    navigation?.removeAttribute('inert');
    menuScrim?.setAttribute('aria-hidden', 'true');
    return;
  }
  setMenu(false);
}

mobileNavigation.addEventListener('change', syncNavigationForViewport);
window.addEventListener('hashchange', () => setMenu(false));
window.addEventListener('pagehide', () => setMenu(false));

syncNavigationForViewport();
markCurrentNavigation();

hydrateNav().catch(() => null);
