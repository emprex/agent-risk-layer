import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from '../public/downloads/agent-risk-inspector.mjs';

function repoWith(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-output-validation-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'output-validation-fixture',
    dependencies: { openai: '4.56.0' },
  }));
  fs.writeFileSync(path.join(root, 'agent.js'), source);
  return root;
}

const aiPrelude = `import OpenAI from 'openai';\nconst client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });\n`;

test('ARL-AI-006 remains when model tool arguments have no independent validation', async (t) => {
  const root = repoWith(aiPrelude + `
export async function run() {
  const completion = await client.chat.completions.create({ model: 'gpt-4o-mini' });
  const call = completion.choices?.[0]?.message?.tool_calls?.[0];
  const args = JSON.parse(call.function.arguments);
  return issueRefund(args);
}
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true });
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-AI-006'));
});

test('ARL-AI-006 resolves when a real manual validation boundary enforces shape, types and business constraints', async (t) => {
  const root = repoWith(aiPrelude + `
const MAX_REFUND_GBP = 500;
const refundSchema = { type: 'object', additionalProperties: false, required: ['accountId','orderId','amount','reason'] };
function validateStructuredRefundOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Refund output must be an object');
  const allowedKeys = new Set(['accountId','orderId','amount','reason']);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error('Unexpected refund field');
  if (typeof value.accountId !== 'string' || typeof value.orderId !== 'string' || typeof value.reason !== 'string') throw new Error('Invalid string field');
  if (!Number.isFinite(value.amount) || value.amount <= 0 || value.amount > MAX_REFUND_GBP) throw new Error('Invalid amount');
  if (value.reason.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value.accountId)) throw new Error('Invalid constraint');
  return { accountId: value.accountId, orderId: value.orderId, amount: value.amount, reason: value.reason };
}
export async function run() {
  const completion = await client.chat.completions.create({ model: 'gpt-4o-mini', tools: [{ type: 'function', function: { name: 'issue_refund', parameters: refundSchema } }] });
  const call = completion.choices?.[0]?.message?.tool_calls?.[0];
  const modelArguments = JSON.parse(call.function.arguments);
  const validatedArguments = validateStructuredRefundOutput(modelArguments);
  return issueRefund(validatedArguments);
}
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true });
  assert.equal(bundle.findings.some((item) => item.ruleId === 'ARL-AI-006'), false);
});

test('comments naming validation do not suppress ARL-AI-006', async (t) => {
  const root = repoWith(aiPrelude + `
// validateStructuredOutput: additionalProperties false; typeof args.amount !== 'number'; throw new Error; Object.keys(args); allowedKeys; JSON.parse(call.function.arguments)
export async function run() {
  const completion = await client.chat.completions.create({ model: 'gpt-4o-mini' });
  const call = completion.choices?.[0]?.message?.tool_calls?.[0];
  const args = JSON.parse(call.function.arguments);
  return issueRefund(args);
}
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true });
  assert.ok(bundle.findings.some((item) => item.ruleId === 'ARL-AI-006'));
});

test('known schema-validation frameworks remain recognised', async (t) => {
  const root = repoWith(aiPrelude + `
import { z } from 'zod';
const Refund = z.object({ amount: z.number() });
export async function run() {
  const completion = await client.chat.completions.create({ model: 'gpt-4o-mini' });
  return Refund.safeParse(completion);
}
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = await scanRepository(root, { authorised: true });
  assert.equal(bundle.findings.some((item) => item.ruleId === 'ARL-AI-006'), false);
});
