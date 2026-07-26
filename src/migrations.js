import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(root, 'migrations');
const MIGRATION_LOCK_ID = 814720260;
function checksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}
export async function runMigrations(db) {
    if (db.kind !== 'postgres')
        return { applied: [], skipped: [], adapter: db.kind };
    const entries = (await fs.readdir(migrationsDirectory))
        .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
        .sort();
    return db.transaction(async () => {
        await db.exec(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`);
        await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
        const appliedRows = await db.prepare('SELECT version, checksum FROM schema_migrations').all();
        const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
        const result = { applied: [], skipped: [], adapter: db.kind };
        for (const name of entries) {
            const sql = await fs.readFile(path.join(migrationsDirectory, name), 'utf8');
            const digest = checksum(sql);
            if (applied.has(name)) {
                if (applied.get(name) !== digest)
                    throw new Error(`Migration checksum mismatch: ${name}`);
                result.skipped.push(name);
                continue;
            }
            await db.exec(sql);
            await db.prepare('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)').run(name, digest);
            result.applied.push(name);
        }
        return result;
    });
}
