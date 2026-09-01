import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('ARL17K public proof explains the buyer problem and ends with one assessment action', () => {
  const html = read('public/arl17k.html');
  assert.match(html, /Could your AI agent keep trying until an ordinary weakness becomes a consequential action\?/);
  assert.match(html, /17,600-attempt workload/);
  assert.match(html, /contained at attempt 26/i);
  assert.match(html, /href="\/assessment\.html">Assess one agent free/);
  assert.match(html, /Unknowns remain evidence gaps; findings require support/);
});

test('ARL17K public proof states the validated Phase 8 outcome precisely', () => {
  const html = read('public/arl17k.html');
  assert.match(html, /17,599 unavailable routes/);
  assert.match(html, /17,607/);
  assert.match(html, /41 \/ 41 ARL17K tests passed/);
  assert.match(html, /f0323357…f90f7847/);
  assert.match(html, /ab480c8e…a5dc2/);
  assert.match(html, /The earlier operator decision remains <code>hold<\/code>/);
});

test('ARL17K public proof preserves the evidence boundary and avoids prevention claims', () => {
  const html = read('public/arl17k.html');
  assert.match(html, /safe synthetic benchmark/i);
  assert.match(html, /does not reproduce that incident/i);
  assert.match(html, /does not establish that AgentRiskLayer would have prevented the real-world incident/i);
  assert.match(html, /not independent monitoring, third-party assurance or an accredited certification/i);
  assert.match(html, /No real network target, credential, customer data, shell execution or production side effect was used/);
  assert.doesNotMatch(html, /ARL stopped 17,600 attacks/i);
});

test('ARL17K public proof keeps customer-facing script boundaries', () => {
  const html = read('public/arl17k.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son\w+\s*=/i);
});
