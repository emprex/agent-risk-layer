// Pure canonical SHA-256 serialization shared by ARL Control Intelligence and
// read-only ENKYRON descriptor integrity inspection. This module has no DB I/O.
import crypto from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function intelligenceDigest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}
