#!/usr/bin/env node
// ENKYRON UX-15B-FIDO0: read-only hardware compatibility check.
// Calls only fido2-token -L and fido2-token -I /dev/hidrawN.
// Never sets/resets a PIN, creates credentials, changes a key, or queries
// the user's existing GitHub / ChatGPT passkeys.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseFidoDevicePaths(output) {
  if (typeof output !== 'string') return [];
  return [...new Set(
    output.split(/\r?\n/).map(line => {
      const match = /^\s*(\/dev\/hidraw[0-9]+)\s*:/.exec(line);
      return match?.[1] || null;
    }).filter(Boolean)
  )];
}

export function parseFidoInfo(output) {
  const text = typeof output === 'string' ? output : '';
  const versionsLine = text.match(/^\s*version strings\s*:\s*(.*)$/im)?.[1] || '';
  const optionsLine = text.match(/^\s*options\s*:\s*(.*)$/im)?.[1] || '';
  const versions = versionsLine.split(',').map(s => s.trim()).filter(Boolean);
  const options = optionsLine.split(',').map(s => s.trim()).filter(Boolean);
  const supportsFido2 = versions.some(v => /^FIDO_2_(?:0|1)(?:_PRE)?$/.test(v));
  const supportsU2f = versions.includes('U2F_V2');
  const uvIndicators = options.filter(v => /^(?:clientPin|uv|pinUvAuthToken|alwaysUv)$/.test(v));
  return {
    versions, supportsFido2, supportsU2f, uvIndicators,
    verifiedUser: false, // GET_INFO cannot prove actual PIN authentication!
  };
}

function runReadOnly(args) {
  const proc = spawnSync('fido2-token', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 12000, maxBuffer: 64 * 1024,
  });
  if (proc.error) {
    if (proc.error.code === 'ENOENT') {
      throw new Error(
        'FIDO2_TOOLS_MISSING: fido2-token not installed. Debian package: fido2-tools.'
      );
    }
    throw new Error('FIDO2_TOOL_ERROR: ' + proc.error.code);
  }
  if (proc.status !== 0) {
    // Never include raw stderr, which may contain device-identifying data.
    throw new Error('FIDO2_READ_FAILED: unable to query the key. Check USB access.');
  }
  return proc.stdout;
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('Usage: node scripts/enkyron-fido2-preflight.mjs');
  }
  const devices = parseFidoDevicePaths(runReadOnly(['-L']));
  if (devices.length === 0) {
    console.log('FIDO_KEY: NOT_FOUND');
    console.log('No FIDO HID device is accessible with the current Linux account.');
    process.exitCode = 2;
    return;
  }
  if (devices.length !== 1) {
    console.log('FIDO_KEYS: ' + devices.length);
    console.log('Plug in exactly one security key and run the check again.');
    process.exitCode = 2;
    return;
  }
  const device = devices[0];
  const info = parseFidoInfo(runReadOnly(['-I', device]));
  console.log('ENKYRON_FIDO_READ_ONLY: YES');
  console.log('DEVICE_PATH: ' + device);
  console.log('CTAP_VERSIONS: ' + (info.versions.join(', ') || 'UNREPORTED'));
  console.log('FIDO2: ' + (info.supportsFido2 ? 'SUPPORTED' : 'NOT_CONFIRMED'));
  console.log('U2F: ' + (info.supportsU2f ? 'REPORTED' : 'NOT_REPORTED'));
  console.log('PIN_UV_INDICATORS: ' + (info.uvIndicators.join(', ') || 'NONE_REPORTED'));
  console.log('USER_VERIFICATION: NOT_TESTED');
  console.log('KEY_CONTENTS: UNCHANGED');
  console.log('ENKYRON_FOUNDER_LOGIN: NOT_YET_IMPLEMENTED');
  if (!info.supportsFido2 || info.uvIndicators.length === 0) {
    console.log('VERDICT: further capability/UV verification required for PIN-protected founder login.');
    process.exitCode = 2;
  } else {
    console.log('VERDICT: hardware advertises capabilities for further FIDO2 registration/login testing.');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('ENKYRON_FIDO_PREFLIGHT:', String(error?.message || 'unknown error'));
    process.exitCode = 1;
  });
}
