import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepository, INSPECTOR_VERSION } from '../public/downloads/agent-risk-inspector.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-ai005-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

async function ruleIds(files) {
  const root = fixture(files);
  try {
    const bundle = await scanRepository(root, { authorised: true, environment: 'test' });
    return bundle.findings.map((item) => item.ruleId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('release scanner recognises bounded OpenAI execution controls used by Northstar', async () => {
  assert.equal(INSPECTOR_VERSION, '4.1.4');
  const ids = await ruleIds({
    'src/agent.js': `
      import OpenAI from 'openai';
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 1 });
      const MAX_COMPLETION_TOKENS = 500;
      const MAX_TOOL_CALLS = 1;
      export async function run(input) {
        const completion = await client.chat.completions.create({ model: 'gpt-4o-mini', max_completion_tokens: MAX_COMPLETION_TOKENS, messages: [{ role: 'user', content: input }] });
        const toolCalls = completion.choices?.[0]?.message?.tool_calls ?? [];
        if (toolCalls.length > MAX_TOOL_CALLS) throw new Error('tool-call limit exceeded');
        return toolCalls[0] ?? null;
      }
    `,
  });
  assert.ok(!ids.includes('ARL-AI-005'), `unexpected ARL-AI-005 in ${ids.join(', ')}`);
});

test('comments cannot satisfy ARL-AI-005 resource evidence', async () => {
  const ids = await ruleIds({
    'src/agent.js': `
      import OpenAI from 'openai';
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      // timeout: 15000, maxRetries: 1, max_completion_tokens: 500
      // toolCalls.length > MAX_TOOL_CALLS
      export async function run(input) {
        return client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: input }] });
      }
    `,
  });
  assert.ok(ids.includes('ARL-AI-005'));
});

test('one incidental limit alone does not suppress ARL-AI-005', async () => {
  const ids = await ruleIds({
    'src/agent.js': `
      import OpenAI from 'openai';
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 15000 });
      export async function run(input) {
        return client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: input }] });
      }
    `,
  });
  assert.ok(ids.includes('ARL-AI-005'));
});

test('limits in an unrelated source file do not suppress an unbounded AI integration', async () => {
  const ids = await ruleIds({
    'src/agent.js': `
      import OpenAI from 'openai';
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      export async function run(input) {
        return client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: input }] });
      }
    `,
    'src/http-client.js': `
      export const config = { timeout: 1000, maxRetries: 1, max_completion_tokens: 20 };
    `,
  });
  assert.ok(ids.includes('ARL-AI-005'));
});
