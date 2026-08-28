import fs from 'node:fs';
import path from 'node:path';
import { buildFixProveEvidencePacket, renderFixProveMarkdown } from '../src/fix-prove-evidence.js';

function usage() {
  console.log('Usage: node scripts/build-fix-prove-evidence.mjs <input.json> [--json out.json] [--md out.md]');
}

function parseArgs(argv) {
  const args = { input: null, json: null, md: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') args.json = argv[++index];
    else if (item === '--md') args.md = argv[++index];
    else if (!args.input) args.input = item;
    else throw new Error(`Unexpected argument: ${item}`);
  }
  return args;
}

function writePrivate(file, content) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, { mode: 0o600 });
  return resolved;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  usage();
  process.exitCode = 1;
} else {
  const inputPath = path.resolve(args.input);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const packet = buildFixProveEvidencePacket(input);
  const json = JSON.stringify(packet, null, 2) + '\n';
  const markdown = renderFixProveMarkdown(packet);

  if (!args.json && !args.md) {
    process.stdout.write(json);
  } else {
    if (args.json) console.log(`JSON evidence: ${writePrivate(args.json, json)}`);
    if (args.md) console.log(`Markdown evidence: ${writePrivate(args.md, markdown)}`);
  }
}
