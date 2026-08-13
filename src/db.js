import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { runMigrations } from './migrations.js';
const useSqliteTestAdapter = config.nodeEnv === 'test' && !config.databaseUrl;
if (!useSqliteTestAdapter && !config.databaseUrl) {
    throw new Error('DATABASE_URL is required. AgentRiskLayer no longer supports SQLite persistence.');
}
export const db = useSqliteTestAdapter
    ? (await import('./db-adapters/sqlite-local.js')).createSqliteTestDatabase()
    : await (await import('./db-adapters/postgres.js')).createPostgresDatabase(config);
if (db.kind === 'sqlite-test') {
    // Production migrations are PostgreSQL-only. The test adapter preloads the
    // additive evidence schema; load the newest Control Intelligence migration
    // here as well so the full SQLite-backed suite exercises the same binding
    // columns and trust-revision table as production without changing release
    // persistence behavior.
    const migration = fs.readFileSync(new URL('../migrations/020_control_intelligence_redteam_binding.sql', import.meta.url), 'utf8');
    await db.exec(migration);
}
let initialised = false;
let initialising;
export async function initialiseDatabase() {
    if (initialised)
        return { ready: true, adapter: db.kind, alreadyInitialised: true };
    if (initialising)
        return initialising;
    initialising = (async () => {
        const migrations = await runMigrations(db);
        if (config.adminEmail) {
            await db.prepare(`UPDATE users SET role='superuser' WHERE email=?`).run(config.adminEmail);
        }
        if (db.kind === 'postgres') {
            const legacyRows = await db.prepare(`SELECT id, share_token FROM assessments WHERE access_token IS NULL OR access_token = ''`).all();
            for (const row of legacyRows) {
                await db.prepare('UPDATE assessments SET access_token=?, share_token=? WHERE id=?')
                    .run(row.share_token, `share_${crypto.randomUUID().replaceAll('-', '')}`, row.id);
            }
        }
        initialised = true;
        return { ready: true, adapter: db.kind, migrations };
    })();
    try {
        return await initialising;
    }
    finally {
        initialising = null;
    }
}
export function nowIso() {
    return new Date().toISOString();
}
export function id(prefix = '') {
    return `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
}
export async function insertEvent(name, userId = null, properties = {}) {
    await db.prepare(`
    INSERT INTO events (id, user_id, name, properties_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id('evt_'), userId, name, JSON.stringify(properties), nowIso());
}