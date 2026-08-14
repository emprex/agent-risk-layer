import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
const htmlFiles = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html')).sort();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function ids(html) {
  return [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function primaryNavSignature(html) {
  const nav = html.match(/<nav[^>]*data-primary-navigation[^>]*>([\s\S]*?)<\/nav>/i)?.[1] || '';
  return [...nav.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('|');
}

test('every page has one purpose, an accessible landmark shell and reusable navigation', () => {
  assert.ok(htmlFiles.length >= 42, `expected at least 42 maintained HTML pages, got ${htmlFiles.length}`);
  const navVariants = new Set();
  for (const name of htmlFiles) {
    const html = read(`public/${name}`);
    assert.match(html, /<title>[^<]+<\/title>/i, name);
    assert.match(html, /<meta(?=[^>]*name=["']description["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i, name);
    assert.match(html, /class=["'][^"']*skip-link[^"']*["'][^>]+href=["']#main-content["']/i, name);
    assert.match(html, /<header[^>]+data-site-header/i, name);
    assert.match(html, /<nav[^>]+data-primary-navigation/i, name);
    assert.match(html, /<main[^>]+id=["']main-content["']/i, name);
    assert.match(html, /<h1\b/i, name);
    assert.match(html, /site-footer-v10/i, name);
    assert.match(html, /<script[^>]+src=["']\/site-shell\.js["']/i, name);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i, name);
    assert.doesNotMatch(html, /\son\w+\s*=/i, name);
    assert.doesNotMatch(html, /<style\b/i, name);
    const pageIds = ids(html);
    assert.equal(new Set(pageIds).size, pageIds.length, `${name} has duplicate IDs`);
    navVariants.add(primaryNavSignature(html));
  }
  assert.ok(navVariants.size <= 5, `expected at most five role-aware navigation variants, got ${navVariants.size}`);
});

test('public and signed-in navigation use stable human labels and one primary action', () => {
  const publicPage = read('public/index.html');
  for (const label of ['Product', 'See it work', 'Pricing', 'Trust', 'Help', 'Sign in', 'Check an agent free']) {
    assert.match(publicPage, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  }
  const appPage = read('public/dashboard.html');
  for (const label of ['Overview', 'Check risk', 'Live protection', 'Evidence', 'Help', 'Account']) {
    assert.match(appPage, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  }
});

test('mobile navigation is visible, keyboard-operable and protected from legacy responsive rules', () => {
  const shell = read('public/site-shell.js');
  const css = read('public/styles.css');
  assert.match(shell, /aria-expanded/);
  assert.match(shell, /event\.key === 'Escape'/);
  assert.match(shell, /event\.key !== 'Tab'/);
  assert.match(shell, /Close menu/);
  assert.match(shell, /dataset\.menuScrim/);
  assert.match(shell, /toggleAttribute\('inert'/);
  assert.match(shell, /matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(css, /\.button, button, select, input\[type="checkbox"\], input\[type="radio"\]\s*\{\s*min-height:\s*44px/);
  assert.match(css, /\.menu-toggle\s*\{[^}]*min-height:\s*46px/s);
  assert.match(css, /\.site-header-v10\.menu-open \.primary-navigation a[\s\S]*display:\s*inline-flex !important/);
  assert.match(css, /\.site-header:not\(\.site-header-v10\) nav a:not\(\.nav-cta\)/);
  assert.doesNotMatch(css, /(^|\n)\s*nav a:not\(\.nav-cta\)\s*\{\s*display:\s*none/);
  assert.match(css, /body\.site-menu-open\s*\{[^}]*overflow:\s*hidden[^}]*touch-action:\s*none/s);
  assert.match(css, /@media \(max-width:\s*900px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('support contact is separated, tappable and safe to wrap on narrow screens', () => {
  const company = read('public/company.html');
  const css = read('public/styles.css');
  assert.match(company, /<span>Support email<\/span><strong><a href="mailto:support@agentrisklayer\.com">support@agentrisklayer\.com<\/a><\/strong>/);
  assert.match(css, /\.company-facts\s*\{[^}]*display:\s*grid[^}]*gap:\s*10px/s);
  assert.match(css, /\.company-facts > div\s*\{[^}]*display:\s*grid[^}]*gap:\s*6px/s);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('progressive disclosure preserves the complete specialist capability set', () => {
  const control = read('public/control-plane.js');
  for (const capability of ['Policies, keys, approvals, access inventory, remediation and audit records are preserved', 'Create keys', 'Approve one exact action', 'Import a technical inventory', 'Fixes and retests', 'Technical evidence journey']) {
    assert.match(control, new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const server = read('server.js');
  assert.ok(server.includes('/v1/guard'));
  assert.ok(server.includes('/guided-protection-check'));
  assert.match(server, /api\\\/inspections/);
  assert.match(server, /api\\\/redteam/);
  assert.ok(server.includes('/api/workspaces'));
  assert.match(read('public/runtime.html'), /Hosted Guard request/);
  assert.match(read('public/quickstart.html'), /Create a scoped connection key/);
  assert.match(read('public/methodology.html'), /Declared controls/);
  assert.match(read('public/methodology.html'), /Deployment decision/);
});

test('remediation evidence uses an in-page project artifact selector instead of a disappearing prompt', () => {
  const source = read('public/control-plane.js');
  assert.match(source, /Artifact that proves this implementation/);
  assert.match(source, /Current published runtime policy/);
  assert.match(source, /data-remediation-evidence-form/);
  assert.doesNotMatch(source, /prompt\('AgentRiskLayer inventory snapshot ID/);
});

test('trust and conversion pages state evidence boundaries instead of unsupported assurance', () => {
  const pages = ['public/index.html', 'public/trust.html', 'public/methodology.html', 'public/security-center.html', 'public/standards.html', 'public/sample-report.html'].map(read).join('\n');
  assert.match(pages, /not an accredited certification/i);
  assert.match(pages, /No invented certification/i);
  assert.match(pages, /Fictional system and evidence/i);
  assert.doesNotMatch(pages, /guaranteed secure|government approved|EU AI Act certified/i);
});
