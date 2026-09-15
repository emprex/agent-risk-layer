import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SOCIAL_IMAGE } from '../src/social-metadata.js';
const origin = 'https://agentrisklayer.com';
for (const route of ['/', '/research', '/research/mcp-runtime-security-evidence-not-verdict']) {
  const response = await fetch(origin + route, { headers: { 'User-Agent': 'Twitterbot/1.0' }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head);
  const tags = {};
  for (const [prefix, attr, keys] of [
    ['og', 'property', ['title','description','type','url','image','image:secure_url','image:type','image:width','image:height','site_name']],
    ['twitter', 'name', ['card','title','description','image','image:alt','site','creator']],
  ]) for (const key of keys) {
    const matches = [...head.matchAll(new RegExp(`<meta ${attr}="${prefix}:${key}" content="([^"]+)"`, 'g'))];
    assert.equal(matches.length, 1, `${route} ${prefix}:${key}`);
    tags[`${prefix}:${key}`] = matches[0][1];
  }
  assert.equal(tags['og:url'], origin + route);
  assert.equal(tags['og:type'], route.startsWith('/research/') ? 'article' : 'website');
  assert.equal(tags['twitter:card'], 'summary_large_image');
  for (const key of ['og:image','og:image:secure_url','twitter:image']) assert.equal(tags[key], DEFAULT_SOCIAL_IMAGE);
  assert.equal(tags['og:image:type'], 'image/png');
  assert.equal(tags['og:image:width'], '1200');
  assert.equal(tags['og:image:height'], '630');
  console.log(JSON.stringify({ url: response.url, status: response.status, tags: 'valid', type: tags['og:type'] }));
}
const response = await fetch(DEFAULT_SOCIAL_IMAGE, { signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200);
assert.equal(response.headers.get('content-type'), 'image/png');
const image = Buffer.from(await response.arrayBuffer());
const local = await readFile(new URL('../public/' + new URL(DEFAULT_SOCIAL_IMAGE).pathname.slice(1), import.meta.url));
assert.deepEqual(image, local, 'production serves the exact committed PNG');
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
console.log(JSON.stringify({ url: DEFAULT_SOCIAL_IMAGE, status: response.status, contentType: response.headers.get('content-type'), bytes: image.length, dimensions: '1200x630', sha256: createHash('sha256').update(image).digest('hex') }));
