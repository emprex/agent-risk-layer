import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mailAddress,
  validateRecipientGroups,
  buildReplyAllRecipients
} from '../desktop/enkyron-mail-recipient-policy.mjs';

test('M03 accepts and deduplicates To, CC and BCC', () => {
  assert.deepEqual(validateRecipientGroups({
    to: ['A@example.com', 'a@example.com', 'b@example.com'],
    cc: ['c@example.com'],
    bcc: ['private@example.com']
  }), {
    to: ['a@example.com', 'b@example.com'],
    cc: ['c@example.com'],
    bcc: ['private@example.com']
  });
});

test('M03 refuses recipient overlap that could disclose BCC', () => {
  assert.throws(() => validateRecipientGroups({
    to: ['client@example.com'],
    bcc: ['CLIENT@example.com']
  }), /multiple recipient groups/);
});

test('M03 blocks invalid addresses and header injection', () => {
  assert.throws(() => mailAddress('a@example.com\r\nBcc: x@example.com'));
  assert.throws(() => mailAddress('first@example.com,second@example.com'));
  assert.throws(() => validateRecipientGroups({to: []}));
});

test('M03 Reply All honors Reply-To and excludes own mailboxes', () => {
  const result = buildReplyAllRecipients({
    from: 'Customer <customer@example.com>',
    reply_to: ['reply@example.com'],
    to: ['direction@example.com', 'colleague@example.com'],
    cc: ['support@example.com', 'manager@example.com',
         'colleague@example.com'],
    bcc: ['secret@example.com']
  }, ['direction@example.com', 'support@example.com']);

  assert.deepEqual(result, {
    to: ['reply@example.com', 'colleague@example.com'],
    cc: ['manager@example.com'],
    bcc: []
  });
});

test('M03 Reply All works for an outgoing message', () => {
  assert.deepEqual(buildReplyAllRecipients({
    from: 'direction@example.com',
    to: ['customer@example.com'],
    cc: ['assistant@example.com']
  }, ['direction@example.com', 'support@example.com']), {
    to: ['customer@example.com'],
    cc: ['assistant@example.com'],
    bcc: []
  });
});

test('M03 refuses Reply All without an external recipient', () => {
  assert.throws(() => buildReplyAllRecipients({
    from: 'direction@example.com',
    to: ['support@example.com']
  }, ['direction@example.com', 'support@example.com']));
});
