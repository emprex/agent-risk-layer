/*
 * ENKYRON M03 — Recipient policy.
 * Pure validation only: no PostgreSQL, Resend or email transmission.
 */

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function mailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 ||
      /[\x00-\x1f\x7f]/.test(value)) {
    throw Error('Invalid mail address');
  }
  const address = value.trim().toLowerCase();
  const local = address.split('@')[0];
  if (!EMAIL.test(address) || local.length > 64 ||
      local.startsWith('.') || local.endsWith('.') ||
      local.includes('..')) {
    throw Error('Invalid mail address');
  }
  return address;
}

function group(value, name) {
  if (!Array.isArray(value) || value.length > 50) {
    throw Error('Invalid recipient group: ' + name);
  }
  return value.map(mailAddress);
}

export function validateRecipientGroups(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('Invalid recipient groups');
  }

  const result = {to: [], cc: [], bcc: []};
  const owners = new Map();

  for (const key of ['to', 'cc', 'bcc']) {
    for (const address of group(input[key] ?? [], key)) {
      const previous = owners.get(address);
      if (previous && previous !== key) {
        throw Error('Address appears in multiple recipient groups');
      }
      if (!previous) {
        owners.set(address, key);
        result[key].push(address);
      }
    }
  }

  if (!result.to.length || owners.size > 50) {
    throw Error('One To address and at most 50 unique recipients required');
  }
  return result;
}

function providerList(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  throw Error('Invalid provider recipient list');
}

function providerAddress(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
    throw Error('Invalid provider mail address');
  }
  const matched = value.trim().match(/^(?:[^<>]{1,200}\s)?<([^<>]+)>$/);
  return mailAddress(matched ? matched[1] : value);
}

export function buildReplyAllRecipients(message, ownAddresses) {
  if (!message || typeof message !== 'object' ||
      !Array.isArray(ownAddresses) || !ownAddresses.length) {
    throw Error('Invalid Reply All context');
  }

  const own = new Set(ownAddresses.map(mailAddress));
  const seen = new Set();
  const result = {to: [], cc: [], bcc: []};

  const add = (values, groupName) => {
    for (const value of values) {
      const address = providerAddress(value);
      if (own.has(address) || seen.has(address)) continue;
      seen.add(address);
      result[groupName].push(address);
    }
  };

  const replyTo = providerList(message.reply_to);
  add(replyTo.length ? replyTo : providerList(message.from), 'to');
  add(providerList(message.to), 'to');
  add(providerList(message.cc), 'cc');

  // Never include the original BCC field in Reply All.
  if (!result.to.length) {
    throw Error('No verified external Reply All recipient');
  }
  return validateRecipientGroups(result);
}
