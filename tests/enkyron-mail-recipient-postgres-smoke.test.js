import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';

import {
  createMailDraft,
  readMailDraft,
  updateMailDraft
} from '../desktop/enkyron-crm-mail-drafts.mjs';

const enabled=process.env.M03_DISPOSABLE_TEST==='1';

test('M03-C durable recipients and legacy protection', {
  skip:!enabled && 'Requires isolated PostgreSQL',
  timeout:45000
},async()=>{
  assert.ok(process.env.PGHOST);
  assert.ok(process.env.PGPORT);

  const pool=new pg.Pool({max:2});
  const owner='ci_m03';
  const workspace='local:'+owner;
  const opportunity='11111111-2222-4333-8444-555555555555';

  try{
    const identity=await pool.query(
      "SELECT current_database() AS db, "+
      "to_regclass('public.enkyron_crm_mail_drafts') AS existing"
    );

    assert.notEqual(identity.rows[0].db,'arl_local');
    assert.equal(identity.rows[0].existing,null,
      'The disposable database must not contain existing Mail data');

    await pool.query(`
      CREATE TABLE enkyron_crm_opportunities (
        id TEXT,
        workspace_key TEXT,
        company_name_at_creation TEXT
      );

      CREATE TABLE enkyron_crm_companies (
        id TEXT,
        workspace_key TEXT,
        name TEXT
      );

      CREATE TABLE enkyron_crm_mail_drafts (
        id TEXT PRIMARY KEY,
        workspace_key TEXT NOT NULL,
        opportunity_id TEXT,
        company_id TEXT,
        mailbox_key TEXT NOT NULL DEFAULT 'direction',
        recipient_email TEXT,
        subject TEXT NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE enkyron_crm_mail_draft_events (
        id TEXT PRIMARY KEY,
        workspace_key TEXT,
        draft_id TEXT,
        revision INTEGER,
        event_type TEXT,
        content_sha256 CHAR(64),
        actor_local TEXT
      );

      CREATE TABLE enkyron_crm_mail_manual_sends (
        id TEXT,
        workspace_key TEXT,
        draft_id TEXT,
        provider TEXT,
        provider_message_id TEXT,
        sender_email TEXT,
        sent_at TIMESTAMPTZ,
        draft_revision INTEGER
      );

      CREATE TABLE enkyron_mail_send_attempts (
        id TEXT,
        workspace_key TEXT,
        draft_id TEXT,
        outcome TEXT,
        provider_message_id TEXT
      );
    `);

    const migration=readFileSync(
      new URL('../migrations/117_enkyron_mail_recipients.sql',
        import.meta.url),'utf8'
    );

    await pool.query(migration);

    await pool.query(
      'INSERT INTO enkyron_crm_opportunities '+
      '(id,workspace_key,company_name_at_creation) VALUES($1,$2,$3)',
      [opportunity,workspace,'Synthetic Opportunity']
    );

    const modern=await createMailDraft(pool,{
      opportunity_id:opportunity,
      mailbox_key:'direction',
      to_recipients:[
        'one@example.com','two@example.com'
      ],
      cc_recipients:['manager@example.com'],
      bcc_recipients:['private@example.com'],
      subject:'Synthetic professional email',
      body_text:'Internal test only. Never sent.'
    },owner);

    const saved=await readMailDraft(pool,modern.id,owner);

    assert.equal(saved.draft.recipient_email,'one@example.com');
    assert.deepEqual(saved.draft.to_recipients,[
      'one@example.com','two@example.com'
    ]);
    assert.deepEqual(saved.draft.cc_recipients,[
      'manager@example.com'
    ]);
    assert.deepEqual(saved.draft.bcc_recipients,[
      'private@example.com'
    ]);

    // Legacy Qt cannot edit a draft containing hidden recipients.
    await assert.rejects(
      updateMailDraft(pool,{
        id:modern.id,
        expected_revision:1,
        recipient_email:'other@example.com',
        subject:'Legacy modification attempt',
        body_text:'Should not be saved'
      },owner),
      /professional recipients require the full editor/
    );

    const afterRefusal=await readMailDraft(
      pool,modern.id,owner
    );

    assert.equal(afterRefusal.draft.revision,1);
    assert.deepEqual(afterRefusal.draft.bcc_recipients,[
      'private@example.com'
    ]);

    // Full professional snapshots remain editable.
    const updated=await updateMailDraft(pool,{
      id:modern.id,
      expected_revision:1,
      mailbox_key:'direction',
      recipient_email:'one@example.com',
      to_recipients:[
        'one@example.com','two@example.com'
      ],
      cc_recipients:['manager@example.com'],
      bcc_recipients:['private@example.com'],
      subject:'Synthetic professional email revised',
      body_text:'Still an unsent local draft.'
    },owner);

    assert.equal(updated.revision,2);

    const modernAfter=await readMailDraft(
      pool,modern.id,owner
    );

    assert.equal(modernAfter.draft.revision,2);
    assert.deepEqual(modernAfter.draft.bcc_recipients,[
      'private@example.com'
    ]);

    // Old single-recipient drafts must keep working.
    const legacy=await createMailDraft(pool,{
      opportunity_id:opportunity,
      recipient_email:'old@example.com',
      subject:'Legacy email',
      body_text:'Single-recipient draft'
    },owner);

    const legacyUpdated=await updateMailDraft(pool,{
      id:legacy.id,
      expected_revision:1,
      recipient_email:'new@example.com',
      subject:'Legacy email revised',
      body_text:'Still not sent'
    },owner);

    assert.equal(legacyUpdated.revision,2);

    const legacyAfter=await readMailDraft(
      pool,legacy.id,owner
    );

    assert.deepEqual(legacyAfter.draft.to_recipients,[
      'new@example.com'
    ]);
    assert.deepEqual(legacyAfter.draft.cc_recipients,[]);
    assert.deepEqual(legacyAfter.draft.bcc_recipients,[]);

    const attempts=await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_mail_send_attempts'
    );
    assert.equal(attempts.rows[0].n,0);

    console.log('PASS: durable To/CC/BCC');
    console.log('PASS: legacy editor cannot alter hidden recipients');
    console.log('PASS: professional revision preserved');
    console.log('PASS: legacy single-recipient edits remain compatible');
    console.log('PASS: no provider send attempt');
  }finally{
    await pool.end();
  }
});
