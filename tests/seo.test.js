import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('SEO discovery endpoints remain enabled', () => {
  const server = read('server.js');
  assert.match(server, /url\.pathname === '\/robots\.txt'/);
  assert.match(server, /url\.pathname === '\/sitemap\.xml'/);
  assert.match(server, /Sitemap: \$\{config\.baseUrl\}\/sitemap\.xml/);
  assert.ok(server.includes("url.pathname.match(/^\\/checks\\/([^/]+)$/)"));
});

test('sitemap uses absolute canonical-origin URLs from production config', () => {
  const server = read('server.js');
  assert.match(server, /config\.baseUrl \+ item/);
  for (const pathName of ['/', '/assessment.html', '/pricing.html', '/trust.html', '/methodology.html', '/runtime.html']) {
    assert.ok(server.includes(`'${pathName}'`), `${pathName} should remain discoverable through the sitemap`);
  }
});

test('shared SEO layer strips tracking parameters from canonical URLs and protects private app pages', () => {
  const seo = read('public/seo.js');
  assert.match(seo, /https:\/\/agentrisklayer\.com/);
  assert.match(seo, /link\[rel="canonical"\]/);
  assert.match(seo, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(seo, /max-image-preview:large/);
  assert.match(seo, /\/dashboard\.html/);
  assert.match(seo, /\/result\.html/);
  assert.match(seo, /\/success\.html/);
  assert.doesNotMatch(seo, /location\.search/);
});

test('public shell loads SEO metadata without changing the existing navigation behaviour', () => {
  const shell = read('public/site-shell.js');
  assert.match(shell, /import \{ applyDocumentSeo \} from '\.\/seo\.js'/);
  assert.match(shell, /applyDocumentSeo\(\)/);
  assert.match(shell, /hydrateNav\(\)\.catch/);
});

test('homepage structured data is bounded to visible, supportable claims', () => {
  const seo = read('public/seo.js');
  for (const schemaType of ['WebSite', 'Organization', 'SoftwareApplication', 'SecurityApplication']) {
    assert.ok(seo.includes(schemaType), `${schemaType} should be represented`);
  }
  assert.match(seo, /name: 'Community'/);
  assert.match(seo, /price: '0'/);
  assert.match(seo, /priceCurrency: 'GBP'/);
  for (const unsupportedClaim of ['accredited', 'certified', 'guaranteed secure', 'SOC 2 certified']) {
    assert.equal(seo.toLowerCase().includes(unsupportedClaim.toLowerCase()), false, `structured data must not claim ${unsupportedClaim}`);
  }
});

test('search and social images are present as local crawlable assets', () => {
  for (const asset of ['public/agentrisklayer-logo-512.png', 'public/agentrisklayer-social-1200x630.png']) {
    const stat = fs.statSync(path.join(root, asset));
    assert.ok(stat.isFile());
    assert.ok(stat.size > 1000, `${asset} should contain an actual image`);
  }
});
