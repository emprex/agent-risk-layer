import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql = readFileSync(
  new URL('../migrations/117_enkyron_mail_recipients.sql',
    import.meta.url), 'utf8'
);

const statements = sql.replace(/--[^\n]*/g, '');

test('M03-B adds three distinct JSONB recipient fields', () => {
  for (const field of [
    'to_recipients', 'cc_recipients', 'bcc_recipients'
  ]) {
    assert.match(
      statements,
      new RegExp(
        `ADD COLUMN ${field} JSONB NOT NULL DEFAULT '\\[\\]'::jsonb`
      )
    );
    assert.match(
      statements,
      new RegExp(`jsonb_typeof\\(${field}\\) = 'array'`)
    );
  }
});

test('M03-B preserves historical primary recipients', () => {
  assert.match(
    statements,
    /SET to_recipients = jsonb_build_array\(recipient_email\)/
  );
  assert.match(statements, /WHERE recipient_email IS NOT NULL/);
  assert.match(statements, /btrim\(recipient_email\) <> ''/);
});

test('M03-B limits total recipient count', () => {
  assert.match(
    statements,
    /jsonb_array_length\(to_recipients\)[\s\S]*?jsonb_array_length\(cc_recipients\)[\s\S]*?jsonb_array_length\(bcc_recipients\) <= 50/
  );
});

test('M03-B does not delete old data or modify provider records', () => {
  assert.doesNotMatch(
    statements,
    /\b(DROP|DELETE|TRUNCATE)\b/i
  );

  const updates = [...statements.matchAll(/\bUPDATE\s+(\w+)/gi)]
    .map(match => match[1]);

  assert.deepEqual(updates, ['enkyron_crm_mail_drafts']);
  assert.doesNotMatch(
    statements,
    /\b(enkyron_mail_send_attempts|enkyron_crm_mail_draft_events)\b/
  );
});
