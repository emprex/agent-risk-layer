import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderMcpServerRiskAssessmentPage } from '../src/mcp-seo-page.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const canonical = 'https://agentrisklayer.com/checks/mcp-server-risk-assessment';

test('MCP risk page targets the existing URL with descriptive search metadata', () => {
    const html = renderMcpServerRiskAssessmentPage('https://agentrisklayer.com');
    assert.match(html, /<title>MCP Server Risk Assessment & Security Testing \| AgentRiskLayer<\/title>/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.match(html, /<h1>MCP Server Risk Assessment<\/h1>/);
    assert.match(html, /MCP server security testing with evidence/);
    assert.match(html, /tool poisoning/i);
    assert.match(html, /prompt injection/i);
    assert.match(html, /OAuth/i);
    assert.match(html, /dynamic tool discovery/i);
    assert.match(html, /human approval/i);
});

test('MCP risk page preserves AgentRiskLayer finding and retest semantics', () => {
    const html = renderMcpServerRiskAssessmentPage('https://agentrisklayer.com');
    assert.match(html, /Version-bound<\/b> assessment and retest evidence/);
    assert.match(html, /Unknown is not a finding/);
    assert.match(html, /observed or reproducible failure/i);
    assert.match(html, /exact retest/i);
    assert.match(html, /Declarations stay separate from observed evidence/);
    assert.match(html, /Capability alone is not a finding/);
    assert.doesNotMatch(html, /guaranteed secure/i);
    assert.doesNotMatch(html, /MCP certified/i);
    assert.match(html, /not an accredited certification or a guarantee that a system is risk-free/i);
});

test('MCP risk page covers current protocol security context without claiming universal implementation behavior', () => {
    const html = renderMcpServerRiskAssessmentPage('https://agentrisklayer.com');
    assert.match(html, /MCP 2026-07-28/);
    assert.match(html, /stateless requests/i);
    assert.match(html, /issuer validation/i);
    assert.match(html, /resource and audience binding/i);
    assert.match(html, /record the implementation and version in scope rather than assume all MCP clients and servers behave the same way/i);
    assert.match(html, /modelcontextprotocol\.io\/docs\/tutorials\/security\/security_best_practices/);
    assert.match(html, /owasp\.org\/www-community\/attacks\/MCP_Tool_Poisoning/);
});

test('MCP risk page keeps strong internal paths to assessment, runtime, evidence and commercial context', () => {
    const html = renderMcpServerRiskAssessmentPage('https://agentrisklayer.com');
    for (const href of [
        '/assessment.html?type=MCP-enabled%20agent',
        '/runtime.html',
        '/sample-report.html',
        '/methodology.html',
        '/trust.html',
        '/pricing.html',
        '/ai-agent-security-assessment.html',
    ]) {
        assert.ok(html.includes(`href="${href}"`), `${href} should be linked from the MCP page`);
    }
    assert.match(html, /£99 <em>once<\/em>/);
    assert.match(html, /From £29 <em>\/month<\/em>/);
});

test('existing MCP route delegates only the MCP slug to the dedicated renderer', () => {
    const server = read('server.js');
    assert.ok(server.includes("url.pathname.match(/^\\/checks\\/([^/]+)$/)"));
    assert.match(server, /renderMcpServerRiskAssessmentPage/);
    assert.match(server, /slug === 'mcp-server-risk-assessment'/);
    assert.match(server, /renderSeoPage\(page\)/);
});
