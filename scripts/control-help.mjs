#!/usr/bin/env node

import {
  controlCount,
  formatControlHelp,
  formatControlList,
  normalizeControlId,
} from '../src/agent/control-help.mjs';

function usage() {
  return [
    'ARL control catalogue',
    '',
    'Usage:',
    '  node scripts/control-help.mjs list',
    '  node scripts/control-help.mjs search <term>',
    '  node scripts/control-help.mjs help ARL-KB-041',
    '  node scripts/control-help.mjs man ARL-KB-041',
    '  node scripts/control-help.mjs ARL-KB-041',
    '',
    `Catalogue: ${controlCount()} controls`,
  ].join('\n');
}

const args = process.argv.slice(2);
const command = String(args[0] ?? 'list').toLowerCase();

if (command === 'list') {
  console.log(formatControlList());
  process.exit(0);
}

if (command === 'search') {
  const query = args.slice(1).join(' ').trim();
  if (!query) {
    console.error('Search term required.');
    console.error(usage());
    process.exit(1);
  }
  const output = formatControlList({ query });
  if (!output) {
    console.error(`No ARL controls matched: ${query}`);
    process.exit(1);
  }
  console.log(output);
  process.exit(0);
}

const requestedId = command === 'help' || command === 'man' ? args[1] : args[0];
const controlId = normalizeControlId(requestedId);
if (!controlId) {
  console.error(usage());
  process.exit(1);
}

const help = formatControlHelp(controlId);
if (!help) {
  console.error(`Unknown ARL control: ${controlId}`);
  process.exit(1);
}

console.log(help);
