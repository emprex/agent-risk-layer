import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('AI agent security assessment page targets commercial search intent without unsupported claims', () => {
  const page = read('public/ai-agent-security-assessment.html');
  assert.match(page, /<title>AI Agent Security Assessment \| AgentRiskLayer<\/title>/);
  assert.match(page, /rel="canonical" href="https:\/\/agentrisklayer\.com\/ai-agent-security-assessment\.html"/);
  assert.match(page, /<h1>AI Agent Security Assessment<\/h1>/);
  for (const phrase of ['MCP', 'prompt injection', 'human approval', 'remediation', 'exact retest', '£99']) {
    assert.ok(page.toLowerCase().includes(phrase.toLowerCase()), `page should cover ${phrase}`);
  }
  assert.match(page, /A finding requires an observed or reproducible failure/);
  assert.match(page, /Unknown or unconfirmed information remains context/);
  assert.match(page, /not an accredited certification or a guarantee that a system is risk-free/);
  assert.doesNotMatch(page, /certified secure|guaranteed secure|independently certified/i);
});

test('AI agent security assessment page has crawlable commercial and evidence links', () => {
  const page = read('public/ai-agent-security-assessment.html');
  for (const href of ['/assessment.html', '/sample-report.html', '/pricing.html', '/methodology.html', '/trust.html', '/runtime.html', '/checks/mcp-server-risk-assessment']) {
    assert.ok(page.includes(`href="${href}"`), `${href} should be linked from the acquisition page`);
  }
  assert.match(page, /data-shell="public"/);
  assert.match(page, /src="\/site-shell\.js"/);
});

test('shared public shell exposes a crawlable internal link to the acquisition page without changing primary navigation', () => {
  const shell = read('public/site-shell.js');
  assert.match(shell, /href = '\/ai-agent-security-assessment\.html'/);
  assert.match(shell, /textContent = 'AI agent security assessment'/);
  assert.match(shell, /document\.body\.dataset\.shell !== 'public'/);
  assert.doesNotMatch(shell, /navigation\.append.*ai-agent-security-assessment/);
});
