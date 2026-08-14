import { api, hydrateNav } from './shared.js';
import { applyDocumentSeo } from './seo.js';

for (const [href, dataKey] of [['/premium-theme.css', 'arlPremiumTheme'], ['/premium-media.css', 'arlPremiumMedia'], ['/visual-experience.css', 'arlVisualExperience']]) {
  if (document.querySelector(`link[href="${href}"]`)) continue;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = href;
  stylesheet.dataset[dataKey] = '';
  document.head.appendChild(stylesheet);
}

applyDocumentSeo();

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-primary-navigation]');
const mobileNavigation = window.matchMedia('(max-width: 900px)');
let lastFocusedElement = null;

const workspaceNavigation = Object.freeze([
  { key: 'overview', label: 'Overview', href: '/dashboard.html' },
  { key: 'assess', label: 'Assess', href: '/assessment.html' },
  { key: 'findings', label: 'Findings', href: '/control-plane.html#remediation' },
  { key: 'evidence', label: 'Evidence', href: '/inspector.html' },
  { key: 'runtime', label: 'Runtime', href: '/control-plane.html#runtime' },
  { key: 'settings', label: 'Settings', href: '/dashboard.html#settings' },
]);

function ensureWorkspaceStyles() {
  if (document.querySelector('link[href="/security-workspace.css"]')) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/security-workspace.css';
  stylesheet.dataset.arlSecurityWorkspace = '';
  document.head.appendChild(stylesheet);
}

function currentProjectContext() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('projectId') || '';
  if (requested) {
    sessionStorage.setItem('arl_selected_project', requested);
    return requested;
  }
  return sessionStorage.getItem('arl_selected_project') || '';
}

function contextualHref(item, projectId) {
  if (!projectId) return item.href;
  if (item.key === 'findings' || item.key === 'runtime') {
    const [pathname, hash = ''] = item.href.split('#');
    return `${pathname}?projectId=${encodeURIComponent(projectId)}${hash ? `#${hash}` : ''}`;
  }
  return item.href;
}

function ensureLogoutButton() {
  if (!navigation) return null;
  let logout = navigation.querySelector('#logout');
  if (logout) return logout;
  logout = document.createElement('button');
  logout.type = 'button';
  logout.id = 'logout';
  logout.className = 'button ghost small';
  logout.textContent = 'Log out';
  logout.dataset.siteShellLogout = 'true';
  logout.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      location.href = '/';
    }
  });
  navigation.append(logout);
  return logout;
}

function applyWorkspaceNavigation() {
  if (!navigation) return;
  ensureWorkspaceStyles();
  document.body.dataset.shell = 'app';
  const projectId = currentProjectContext();
  const logout = navigation.querySelector('#logout');
  navigation.querySelectorAll('a').forEach((link) => link.remove());
  for (const item of workspaceNavigation) {
    const link = document.createElement('a');
    link.href = contextualHref(item, projectId);
    link.textContent = item.label;
    link.dataset.workspaceKey = item.key;
    navigation.insertBefore(link, logout || null);
  }
  const help = document.createElement('a');
  const helpParams = new URLSearchParams({ from: 'workspace' });
  if (projectId) helpParams.set('projectId', projectId);
  help.href = `/help.html?${helpParams.toString()}`;
  help.textContent = 'Help';
  help.className = 'workspace-help-nav';
  help.dataset.workspaceKey = 'help';
  navigation.insertBefore(help, logout || null);
  ensureLogoutButton();
  navigation.dataset.workspaceNavigation = 'true';
  markCurrentNavigation();
}

function normalisePath(value) {
  try {
    const url = new URL(value, location.origin);
    return url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function workspaceCurrentKey() {
  const page = normalisePath(location.pathname);
  const hash = location.hash;
  if (page === '/dashboard.html') return hash === '#settings' ? 'settings' : 'overview';
  if (page === '/assessment.html' || page === '/result.html') return 'assess';
  if (page === '/inspector.html' || page === '/inspection-detail.html') return 'evidence';
  if (page === '/control-plane.html') return hash === '#remediation' ? 'findings' : 'runtime';
  if (page === '/help.html') return 'help';
  return '';
}

function markCurrentNavigation() {
  const current = normalisePath(location.pathname);
  const workspaceKey = document.body.dataset.shell === 'app' ? workspaceCurrentKey() : '';
  document.querySelectorAll('[data-primary-navigation] a[href], [data-local-navigation] a[href]').forEach((link) => {
    const linkWorkspaceKey = link.dataset.workspaceKey || '';
    const target = normalisePath(link.getAttribute('href'));
    const match = workspaceKey && linkWorkspaceKey
      ? workspaceKey === linkWorkspaceKey
      : target && (target === current || (target !== '/' && current.startsWith(target.replace(/\.html$/, ''))));
    if (match) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function ensureSeoAcquisitionLink() {
  if (document.body.dataset.shell !== 'public' || document.querySelector('a[href="/ai-agent-security-assessment.html"]')) return;
  const productHeading = [...document.querySelectorAll('footer strong')].find((node) => node.textContent.trim() === 'Product');
  const productColumn = productHeading?.parentElement;
  if (!productColumn) return;
  const link = document.createElement('a');
  link.href = '/ai-agent-security-assessment.html';
  link.textContent = 'AI agent security assessment';
  const mcpLink = productColumn.querySelector('a[href="/checks/mcp-server-risk-assessment"]');
  productColumn.insertBefore(link, mcpLink || productHeading.nextSibling);
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

async function initialiseShell() {
  if (document.body.dataset.shell === 'app') applyWorkspaceNavigation();
  else markCurrentNavigation();
  ensureSeoAcquisitionLink();

  const user = await hydrateNav().catch(() => null);
  if (location.pathname.endsWith('/help.html') && user) {
    applyWorkspaceNavigation();
    const brand = document.querySelector('.brand-v10');
    if (brand) {
      brand.href = '/dashboard.html';
      brand.setAttribute('aria-label', 'AgentRiskLayer overview');
      const subtitle = brand.querySelector('small');
      if (subtitle) subtitle.textContent = 'Security workspace';
    }
  }
  markCurrentNavigation();
}

mobileNavigation.addEventListener('change', syncNavigationForViewport);
window.addEventListener('hashchange', () => {
  setMenu(false);
  markCurrentNavigation();
});
window.addEventListener('pagehide', () => setMenu(false));

syncNavigationForViewport();
initialiseShell();
