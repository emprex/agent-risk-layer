import { api, hydrateNav } from './shared.js';
import { applyDocumentSeo } from './seo.js';

const WORKSPACE_STYLES = Object.freeze([
  ['/design-tokens.css', 'arlDesignTokens'],
  ['/security-workspace.css', 'arlSecurityWorkspace'],
  ['/workspace-app.css', 'arlWorkspaceApp'],
  ['/workspace-light.css', 'arlWorkspaceLight'],
]);
const PUBLIC_EXPERIENCE_STYLES = Object.freeze([
  ['/design-tokens.css', 'arlDesignTokens'],
  ['/enterprise-light.css', 'arlEnterpriseLight'],
  ['/mobile-navigation-fix.css', 'arlMobileNavigationFix'],
]);
const LEGACY_PUBLIC_STYLES = Object.freeze([
  '/premium-theme.css',
  '/premium-media.css',
  '/visual-experience.css',
]);

function workspaceRequest() {
  if (document.body?.dataset.shell === 'app') return true;
  const params = new URLSearchParams(location.search);
  return location.pathname.endsWith('/help.html') && params.get('from') === 'workspace';
}

function ensureStylesheet(href, dataKey = '') {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = href;
  if (dataKey) stylesheet.dataset[dataKey] = '';
  document.head.appendChild(stylesheet);
}

function prepareVisualSystem() {
  for (const href of LEGACY_PUBLIC_STYLES) {
    document.querySelectorAll(`link[href="${href}"]`).forEach((node) => node.remove());
  }

  if (workspaceRequest()) {
    document.body.dataset.shell = 'app';
    for (const [href] of PUBLIC_EXPERIENCE_STYLES) {
      if (href === '/design-tokens.css') continue;
      document.querySelectorAll(`link[href="${href}"]`).forEach((node) => node.remove());
    }
    for (const [href, dataKey] of WORKSPACE_STYLES) ensureStylesheet(href, dataKey);
    return;
  }

  document.body.dataset.shell = 'public';
  document.querySelectorAll('link[href="/workspace-light.css"]').forEach((node) => node.remove());
  for (const [href, dataKey] of PUBLIC_EXPERIENCE_STYLES) ensureStylesheet(href, dataKey);
}

prepareVisualSystem();
applyDocumentSeo();

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-primary-navigation]');
const mobileNavigation = window.matchMedia('(max-width: 900px)');
let lastFocusedElement = null;

const publicNavigation = Object.freeze([
  { key: 'product', label: 'Product', href: '/#product' },
  { key: 'how', label: 'How it works', href: '/#how-it-works' },
  { key: 'pricing', label: 'Pricing', href: '/pricing.html' },
  { key: 'trust', label: 'Trust', href: '/trust.html' },
]);

const workspaceNavigation = Object.freeze([
  { key: 'overview', label: 'Overview', href: '/dashboard.html' },
  { key: 'assess', label: 'Assess', href: '/assessment.html' },
  { key: 'findings', label: 'Findings', href: '/control-plane.html#remediation' },
  { key: 'evidence', label: 'Evidence', href: '/inspector.html' },
  { key: 'runtime', label: 'Runtime', href: '/control-plane.html' },
  { key: 'settings', label: 'Settings', href: '/dashboard.html#settings' },
]);

function updateWorkspaceView() {
  if (document.body.dataset.shell !== 'app') return;
  document.body.dataset.workspaceView = location.hash ? location.hash.slice(1) : 'summary';
}

function normaliseLegacyRuntimeRoute() {
  if (document.body.dataset.shell !== 'app') return;
  if (!location.pathname.endsWith('/control-plane.html') || location.hash !== '#runtime') return;
  sessionStorage.removeItem('arl_control_plane_mode');
  history.replaceState({}, '', `${location.pathname}${location.search}`);
}

normaliseLegacyRuntimeRoute();
updateWorkspaceView();

function currentNavigationContext() {
  const params = new URLSearchParams(location.search);
  const requestedProject = params.get('projectId') || '';
  const requestedAssessment = params.get('assessment') || '';
  if (requestedProject) sessionStorage.setItem('arl_selected_project', requestedProject);
  if (requestedAssessment) sessionStorage.setItem('arl_selected_assessment', requestedAssessment);
  return {
    projectId: requestedProject || sessionStorage.getItem('arl_selected_project') || '',
    assessmentId: requestedAssessment || sessionStorage.getItem('arl_selected_assessment') || '',
  };
}

function contextualHref(item, context) {
  if (item.key === 'overview' && context.assessmentId) return `/dashboard.html?assessment=${encodeURIComponent(context.assessmentId)}`;
  if (item.key === 'findings') {
    if (context.assessmentId) return `/control-plane.html?assessment=${encodeURIComponent(context.assessmentId)}#remediation`;
    if (context.projectId) return `/control-plane.html?projectId=${encodeURIComponent(context.projectId)}#remediation`;
  }
  if (item.key === 'evidence' && context.assessmentId) return `/inspector.html?assessment=${encodeURIComponent(context.assessmentId)}`;
  if (item.key === 'runtime' && context.projectId) return `/control-plane.html?projectId=${encodeURIComponent(context.projectId)}`;
  return item.href;
}

function applyPublicNavigation() {
  if (!navigation || document.body.dataset.shell !== 'public') return;
  navigation.replaceChildren();
  for (const item of publicNavigation) {
    const link = document.createElement('a'); link.href = item.href; link.textContent = item.label; link.dataset.publicKey = item.key; navigation.append(link);
  }
  const signIn = document.createElement('a'); signIn.href = '/auth.html'; signIn.textContent = 'Sign in'; signIn.className = 'nav-signin'; signIn.dataset.authLink = ''; navigation.append(signIn);
  const primary = document.createElement('a'); primary.href = '/assessment.html'; primary.textContent = 'Check an agent free'; primary.className = 'button primary small nav-primary-action'; navigation.append(primary);
  navigation.dataset.publicNavigation = 'true'; markCurrentNavigation();
}

function ensureLogoutButton() {
  if (!navigation) return null;
  let logout = navigation.querySelector('#logout');
  if (logout) return logout;
  logout = document.createElement('button'); logout.type = 'button'; logout.id = 'logout'; logout.className = 'button ghost small'; logout.textContent = 'Log out'; logout.dataset.siteShellLogout = 'true';
  logout.addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { location.href = '/'; } });
  navigation.append(logout); return logout;
}

function applyWorkspaceNavigation() {
  if (!navigation) return;
  prepareVisualSystem(); const context = currentNavigationContext(); const logout = navigation.querySelector('#logout'); navigation.querySelectorAll('a').forEach((link) => link.remove());
  for (const item of workspaceNavigation) { const link = document.createElement('a'); link.href = contextualHref(item, context); link.textContent = item.label; link.dataset.workspaceKey = item.key; navigation.insertBefore(link, logout || null); }
  const help = document.createElement('a'); const helpParams = new URLSearchParams({ from: 'workspace' }); if (context.projectId) helpParams.set('projectId', context.projectId); if (context.assessmentId) helpParams.set('assessment', context.assessmentId); help.href = `/help.html?${helpParams.toString()}`; help.textContent = 'Help'; help.className = 'workspace-help-nav'; help.dataset.workspaceKey = 'help'; navigation.insertBefore(help, logout || null);
  ensureLogoutButton(); navigation.dataset.workspaceNavigation = 'true'; markCurrentNavigation();
}

function normalisePath(value) { try { const url = new URL(value, location.origin); return url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, ''); } catch { return ''; } }
function workspaceCurrentKey() { const page = normalisePath(location.pathname); const hash = location.hash; if (page === '/dashboard.html') return hash === '#settings' ? 'settings' : 'overview'; if (page === '/assessment.html' || page === '/result.html') return 'assess'; if (page === '/inspector.html' || page === '/inspection-detail.html') return 'evidence'; if (page === '/control-plane.html') return hash === '#remediation' ? 'findings' : 'runtime'; if (page === '/help.html') return 'help'; return ''; }
function publicCurrentKey() { const page = normalisePath(location.pathname); if (page === '/pricing.html') return 'pricing'; if (page === '/trust.html' || page === '/security-center.html' || page === '/methodology.html') return 'trust'; return ''; }
function markCurrentNavigation() { const current = normalisePath(location.pathname); const workspaceKey = document.body.dataset.shell === 'app' ? workspaceCurrentKey() : ''; const publicKey = document.body.dataset.shell === 'public' ? publicCurrentKey() : ''; document.querySelectorAll('[data-primary-navigation] a[href], [data-local-navigation] a[href]').forEach((link) => { const linkWorkspaceKey = link.dataset.workspaceKey || ''; const linkPublicKey = link.dataset.publicKey || ''; const target = normalisePath(link.getAttribute('href')); const match = workspaceKey && linkWorkspaceKey ? workspaceKey === linkWorkspaceKey : publicKey && linkPublicKey ? publicKey === linkPublicKey : target && target !== '/' && (target === current || current.startsWith(target.replace(/\.html$/, ''))); if (match) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }); }
function ensureSeoAcquisitionLink() { if (document.body.dataset.shell !== 'public' || document.querySelector('a[href="/ai-agent-security-assessment.html"]')) return; const productHeading = [...document.querySelectorAll('footer strong')].find((node) => node.textContent.trim() === 'Product'); const productColumn = productHeading?.parentElement; if (!productColumn) return; const link = document.createElement('a'); link.href = '/ai-agent-security-assessment.html'; link.textContent = 'AI agent security assessment'; const mcpLink = productColumn.querySelector('a[href="/checks/mcp-server-risk-assessment"]'); productColumn.insertBefore(link, mcpLink || productHeading.nextSibling); }
function menuLabel(open) { return open ? 'Close menu' : 'Open menu'; }
function setNavigationAvailability(open) { if (!navigation) return; const hiddenOnMobile = mobileNavigation.matches && !open; navigation.setAttribute('aria-hidden', String(hiddenOnMobile)); navigation.toggleAttribute('inert', hiddenOnMobile); }
function createMenuScrim() { if (!header || document.querySelector('[data-menu-scrim]')) return document.querySelector('[data-menu-scrim]'); const scrim = document.createElement('button'); scrim.type = 'button'; scrim.className = 'menu-scrim'; scrim.dataset.menuScrim = ''; scrim.tabIndex = -1; scrim.setAttribute('aria-label', 'Close navigation menu'); scrim.setAttribute('aria-hidden', 'true'); header.insertAdjacentElement('afterend', scrim); return scrim; }
const menuScrim = createMenuScrim();
function setMenu(open, { focus = false, restoreFocus = false } = {}) { if (!header || !menuButton || !navigation) return; const nextOpen = Boolean(open && mobileNavigation.matches); if (nextOpen && !header.classList.contains('menu-open')) lastFocusedElement = document.activeElement; header.classList.toggle('menu-open', nextOpen); menuButton.setAttribute('aria-expanded', String(nextOpen)); menuButton.setAttribute('aria-label', menuLabel(nextOpen)); const label = menuButton.querySelector('.sr-only'); if (label) label.textContent = menuLabel(nextOpen); document.body.classList.toggle('site-menu-open', nextOpen); menuScrim?.setAttribute('aria-hidden', String(!nextOpen)); setNavigationAvailability(nextOpen); if (focus && nextOpen) requestAnimationFrame(() => navigation.querySelector('a[href], button:not([disabled])')?.focus()); if (restoreFocus && !nextOpen) { const target = lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement) ? lastFocusedElement : menuButton; target.focus(); } }
function focusableMenuControls() { if (!header) return []; return [...header.querySelectorAll('button:not([disabled]), a[href]')].filter((element) => !element.hasAttribute('inert')); }
menuButton?.setAttribute('aria-label', menuLabel(false));
menuButton?.addEventListener('click', () => { setMenu(menuButton.getAttribute('aria-expanded') !== 'true', { focus: true, restoreFocus: true }); });
menuScrim?.addEventListener('click', () => setMenu(false, { restoreFocus: true }));
navigation?.addEventListener('click', (event) => { const link = event.target.closest('a[href]'); if (link?.dataset.workspaceKey === 'runtime') sessionStorage.removeItem('arl_control_plane_mode'); if (link) setMenu(false); });
document.addEventListener('click', (event) => { const link = event.target.closest('a[href]'); if (!link || document.body.dataset.shell !== 'app') return; const target = new URL(link.href, location.origin); if (!target.pathname.endsWith('/control-plane.html') || target.hash !== '#runtime') return; event.preventDefault(); sessionStorage.removeItem('arl_control_plane_mode'); target.hash = ''; location.href = `${target.pathname}${target.search}`; });
document.addEventListener('keydown', (event) => { if (!header?.classList.contains('menu-open')) return; if (event.key === 'Escape') { event.preventDefault(); setMenu(false, { restoreFocus: true }); return; } if (event.key !== 'Tab') return; const controls = focusableMenuControls(); if (!controls.length) return; const first = controls[0]; const last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } });
function syncNavigationForViewport() { if (!mobileNavigation.matches) { setMenu(false); navigation?.removeAttribute('aria-hidden'); navigation?.removeAttribute('inert'); menuScrim?.setAttribute('aria-hidden', 'true'); return; } setMenu(false); }
async function initialiseShell() { if (workspaceRequest()) applyWorkspaceNavigation(); else applyPublicNavigation(); ensureSeoAcquisitionLink(); const user = await hydrateNav().catch(() => null); if (location.pathname.endsWith('/help.html') && user && new URLSearchParams(location.search).get('from') === 'workspace') { applyWorkspaceNavigation(); const brand = document.querySelector('.brand-v10'); if (brand) { brand.href = '/dashboard.html'; brand.setAttribute('aria-label', 'AgentRiskLayer overview'); const subtitle = brand.querySelector('small'); if (subtitle) subtitle.textContent = 'Security workspace'; } } markCurrentNavigation(); }
mobileNavigation.addEventListener('change', syncNavigationForViewport);
window.addEventListener('hashchange', () => { setMenu(false); updateWorkspaceView(); markCurrentNavigation(); });
window.addEventListener('pagehide', () => setMenu(false));
syncNavigationForViewport();
initialiseShell();
