import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  INSPECTOR_VERSION,
  scanRepository,
} from '../public/downloads/agent-risk-inspector.mjs';

const root = path.resolve(import.meta.dirname, '..');
const releaseFile = path.join(root, 'public', 'downloads', 'agent-risk-inspector.mjs');
const checksumFile = `${releaseFile}.sha256`;
const metadataFile = path.join(root, 'public', 'downloads', 'inspector-release.json');

function temporaryRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-inspector-release-'));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

test('public Inspector 4.1.4 does not treat unrelated schema validation as agent output evidence', async (t) => {
  const directory = temporaryRepository(t);
  fs.writeFileSync(path.join(directory, 'agent.js'), `import OpenAI from 'openai';\nexport async function run(prompt) { return new OpenAI().responses.create({ input: prompt }); }\n`);
  fs.writeFileSync(path.join(directory, 'unrelated-api.js'), `import { z } from 'zod';\nexport const profile = z.object({ name: z.string() });\n`);

  const bundle = await scanRepository(directory, { authorised:true });

  assert.equal(INSPECTOR_VERSION, '4.1.4');
  assert.ok(bundle.findings.some((finding) => finding.ruleId === 'ARL-AI-006'));
});

test('public Inspector 4.1.4 recognises validation at the AI integration boundary', async (t) => {
  const directory = temporaryRepository(t);
  fs.writeFileSync(path.join(directory, 'validated-agent.js'), `import OpenAI from 'openai';\nimport { z } from 'zod';\nconst output = z.object({ answer: z.string() });\nexport async function run(prompt) { const result = await new OpenAI().responses.create({ input: prompt }); return output.parse(result); }\n`);

  const bundle = await scanRepository(directory, { authorised:true });

  assert.equal(bundle.findings.some((finding) => finding.ruleId === 'ARL-AI-006'), false);
});

test('Inspector release generation is deterministic and published integrity metadata matches the bundle', () => {
  const before = {
    release: fs.readFileSync(releaseFile),
    checksum: fs.readFileSync(checksumFile, 'utf8'),
    metadata: fs.readFileSync(metadataFile, 'utf8'),
  };

  execFileSync(process.execPath, ['scripts/build-inspector-release.mjs'], {
    cwd:root,
    stdio:'pipe',
  });

  const after = {
    release: fs.readFileSync(releaseFile),
    checksum: fs.readFileSync(checksumFile, 'utf8'),
    metadata: fs.readFileSync(metadataFile, 'utf8'),
  };
  assert.deepEqual(after, before);

  const digest = crypto.createHash('sha256').update(after.release).digest('hex');
  const checksumDigest = after.checksum.trim().split(/\s+/)[0];
  const metadata = JSON.parse(after.metadata);

  assert.equal(checksumDigest, digest);
  assert.equal(metadata.sha256, digest);
  assert.equal(metadata.version, INSPECTOR_VERSION);
});
