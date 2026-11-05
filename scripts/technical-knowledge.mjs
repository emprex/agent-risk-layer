#!/usr/bin/env node
import pg from 'pg';
import { createHash } from 'node:crypto';

const request = process.argv.slice(2).join(' ').trim();

if (!request || request.length > 120) {
  console.error('Usage: TECH-001 | ARL-KB-057 | search terms');
  process.exit(2);
}

const db = new pg.Client({
  host: '/var/run/postgresql',
  user: 'emprex',
  database: 'arl_local',
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000
});

let connected = false;

try {
  await db.connect();
  connected = true;
  await db.query('BEGIN READ ONLY');

  const base = `
    SELECT s.id, s.revision, s.title, s.status,
           s.content_markdown, s.content_digest,
           COALESCE(
             (SELECT array_agg(l.control_id ORDER BY l.control_id)
              FROM technical_knowledge_control_links l
              WHERE l.sheet_id = s.id
                AND l.sheet_revision = s.revision),
             ARRAY[]::text[]
           ) AS controls
    FROM technical_knowledge_sheets s`;

  const technicalId = /^TECH-\d{3}$/i.test(request);
  const controlId = /^ARL-KB-\d{3}$/i.test(request);

  let where;
  let parameter;

  if (technicalId) {
    where = 's.id = $1';
    parameter = request.toUpperCase();
  } else if (controlId) {
    where = `EXISTS (
      SELECT 1
      FROM technical_knowledge_control_links l
      WHERE l.sheet_id = s.id
        AND l.sheet_revision = s.revision
        AND l.control_id = $1
    )`;
    parameter = request.toUpperCase();
  } else {
    where = `(s.id ILIKE $1 OR
              s.title ILIKE $1 OR
              s.content_markdown ILIKE $1)`;
    parameter = '%' + request + '%';
  }

  const { rows } = await db.query(
    `${base}
     WHERE ${where}
     ORDER BY s.created_at DESC, s.id
     LIMIT 30`,
    [parameter]
  );

  if (rows.length === 0) {
    throw new Error('No matching technical knowledge sheet.');
  }

  for (const row of rows) {
    const digest = createHash('sha256')
      .update(row.content_markdown, 'utf8')
      .digest('hex');

    if (digest !== row.content_digest) {
      throw new Error(
        'Knowledge integrity failure: ' +
        row.id + ' ' + row.revision
      );
    }
  }

  console.log('ARL TECHNICAL KNOWLEDGE — READ ONLY');
  console.log(
    'SHA-256 verified. Guidance only; never assessment evidence or PASS/FAIL.\n'
  );

  for (const row of rows) {
    console.log(
      `${row.id} v${row.revision} — ${row.title} [${row.status.toUpperCase()}]`
    );
    console.log('Related controls: ' + row.controls.join(', '));

    if (row.status !== 'reviewed') {
      console.log('NOT HUMAN-REVIEWED — reference only.');
    }

    if (technicalId) {
      console.log('\n' + row.content_markdown);
    } else {
      console.log(
        'Open full sheet: node scripts/technical-knowledge.mjs ' +
        row.id
      );
    }

    console.log('');
  }

  await db.query('ROLLBACK');

} catch (error) {
  console.error('TECHNICAL KNOWLEDGE ERROR:', error.message);
  process.exitCode = 1;
} finally {
  if (connected) await db.end();
}
