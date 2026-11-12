#!/usr/bin/env node
// ENK-03 / UAT-01: transactional bootstrap of one FRESH synthetic PostgreSQL DB.
// NEVER run on arl_local. This does not copy or access customer databases.
import os from 'node:os';
import pg from 'pg';
import { runMigrations } from '../src/migrations.js';
import {
  resolveEnkyronDatabase, ENKYRON_UAT_MARKER,
} from '../desktop/enkyron-uat-database.mjs';

const UAT_DB = 'enkyron_uat_enk03';

export function validateBootstrapTarget(target, identity, tables) {
  if (!target.uat || target.database !== UAT_DB) {
    throw new Error('Refusing bootstrap: unexpected UAT database');
  }
  if (identity?.database !== UAT_DB
      || identity?.role !== os.userInfo().username
      || identity?.owner !== identity.role) {
    throw new Error('Refusing bootstrap: database identity or ownership differs');
  }
  if (!Array.isArray(tables) || tables.length > 0) {
    throw new Error('Refusing bootstrap: database is not empty');
  }
}

function placeholderSql(sql, args) {
  let index = 0;
  const compiled = sql.replace(/\?/g, () => '$' + ++index);
  if (index !== args.length) throw new Error('Bootstrap SQL bind count mismatch');
  return compiled;
}

export function migrationAdapter(client) {
  return {
    kind: 'postgres',
    async exec(sql) {
      return client.query(sql);
    },
    prepare(sql) {
      return {
        async all(...args) {
          const result = await client.query(placeholderSql(sql, args), args);
          return result.rows;
        },
        async run(...args) {
          return client.query(placeholderSql(sql, args), args);
        },
      };
    },
    async transaction(work) {
      await client.query('BEGIN');
      try {
        const result = await work();
        // The guard table is committed together with the schema. A partial
        // bootstrap must never leave a supposedly ready UAT environment.
        await client.query(`
          CREATE TABLE public.enkyron_uat_guard (
            marker TEXT PRIMARY KEY
            CHECK (marker = 'ENK03_SYNTHETIC_ONLY')
          )
        `);
        await client.query(
          'INSERT INTO public.enkyron_uat_guard (marker) VALUES ($1)',
          [ENKYRON_UAT_MARKER]
        );
        const verified = await client.query(
          'SELECT current_database() AS database, ' +
          'EXISTS(SELECT 1 FROM public.enkyron_uat_guard WHERE marker=$1) AS verified',
          [ENKYRON_UAT_MARKER]
        );
        if (verified.rows?.[0]?.database !== UAT_DB
            || verified.rows?.[0]?.verified !== true) {
          throw new Error('Bootstrap marker verification failed');
        }
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
}

export async function bootstrapUat() {
  const target = resolveEnkyronDatabase();
  if (target.database !== UAT_DB || !target.uat) {
    throw new Error('Refusing bootstrap: only enkyron_uat_enk03 is allowed');
  }

  // Connect by Unix socket, using the current peer account (not postgres
  // superuser or remote credentials). Do not fall back to another database.
  const pool = new pg.Pool({
    host: '/var/run/postgresql',
    database: target.database,
    user: os.userInfo().username,
    max: 1,
    connectionTimeoutMillis: 5000,
    options: '-c statement_timeout=180000 -c lock_timeout=5000',
  });
  try {
    const client = await pool.connect();
    try {
      const identity = (await client.query(`
        SELECT current_database() AS database, current_user AS role,
               pg_get_userbyid(datdba) AS owner
        FROM pg_database WHERE datname = current_database()
      `)).rows[0];
      const tables = (await client.query(`
        SELECT schemaname, tablename FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      `)).rows;
      validateBootstrapTarget(target, identity, tables);
      const applied = await runMigrations(migrationAdapter(client));
      if (!applied.applied.length || applied.skipped.length) {
        throw new Error('Expected fresh migration registry with no skipped files');
      }
      console.log(JSON.stringify({
        database: target.database,
        applied_migrations: applied.applied.length,
        last_migration: applied.applied.at(-1),
        uat_guard: 'verified',
        note: 'Synthetic database only. UAT business flow not yet run.',
      }, null, 2));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
    console.error('Usage: ENKYRON_UAT_DATABASE=enkyron_uat_enk03 ENKYRON_UAT_GUARD=ENK03_SYNTHETIC_ONLY node scripts/enkyron-enk03-uat-bootstrap.mjs --apply');
    process.exitCode = 2;
  } else {
    bootstrapUat().catch(error => {
      // No passwords, SQL schema contents, or client records are printed.
      console.error('ENK-03 UAT bootstrap refused/failed: ' + String(error?.message || 'unknown failure'));
      process.exitCode = 1;
    });
  }
}
