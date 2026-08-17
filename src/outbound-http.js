import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => blocked.addSubnet(network, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
].forEach(([network, prefix]) => blocked.addSubnet(network, prefix, 'ipv6'));

export function validateOutboundHttpsUrl(value) {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('Integration endpoint must use HTTPS.');
  if (url.username || url.password) throw new Error('Integration endpoint must not contain embedded credentials.');
  if (url.port && url.port !== '443') throw new Error('Integration endpoint must use the standard HTTPS port.');
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Integration endpoint must use a public Internet hostname.');
  }
  const family = isIP(hostname);
  if (family && isBlockedAddress(hostname, family)) throw new Error('Integration endpoint must not target a private or reserved address.');
  return url;
}

export async function resolvePublicHttpsUrl(value, lookup = dns.lookup) {
  const url = validateOutboundHttpsUrl(value);
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('Integration endpoint hostname did not resolve.');
  for (const candidate of addresses) {
    const family = Number(candidate.family) || isIP(candidate.address);
    if (!family || isBlockedAddress(candidate.address, family)) {
      throw new Error('Integration endpoint resolves to a private or reserved address.');
    }
  }
  const pinned = addresses[0];
  return { url, address: pinned.address, family: Number(pinned.family) || isIP(pinned.address) };
}

export async function postJsonPinned(value, { body, headers = {}, timeoutMs = 10000, lookup = dns.lookup } = {}) {
  const target = await resolvePublicHttpsUrl(value, lookup);
  const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const request = https.request(target.url, {
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(payload) },
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (response) => {
      response.resume();
      response.on('end', () => finish(resolve, { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0 }));
      response.on('error', (error) => finish(reject, error));
    });
    const timer = setTimeout(() => {
      const error = new Error(`Delivery timed out after ${timeoutMs} ms`);
      error.name = 'TimeoutError';
      request.destroy(error);
    }, timeoutMs);
    request.on('error', (error) => finish(reject, error));
    request.end(payload);
  });
}

function isBlockedAddress(address, family) {
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = String(address).toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}
