import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDraftCreate,
  validateDraftUpdate
} from '../desktop/enkyron-crm-mail-drafts.mjs';

const base = {
  mailbox_key: 'direction',
  recipient_email: 'client@example.test',
  subject: 'Synthetic draft',
  body_text: 'Not transmitted'
};

test('M03-C preserves the legacy single-recipient contract', () => {
  const created = validateDraftCreate(base);
  assert.equal(created.recipient_email, 'client@example.test');
  assert.equal(created.subject, 'Synthetic draft');
});

test('M03-C refuses to silently discard new recipient fields', () => {
  for (const field of [
    'to_recipients','cc_recipients','bcc_recipients',
    'to','cc','bcc'
  ]) {
    const request = {...base, [field]: ['other@example.test']};
    assert.throws(
      () => validateDraftCreate(request),
      /CRM M03/
    );

    assert.throws(
      () => validateDraftUpdate({
        ...request,
        id: '00000000-0000-4000-8000-000000000001',
        expected_revision: 1
      }),
      /CRM M03/
    );
  }
});
