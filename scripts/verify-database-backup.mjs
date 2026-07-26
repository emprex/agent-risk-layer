#!/usr/bin/env node
import { verifyBackup } from './backup-database.mjs';
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/verify-database-backup.mjs <backup.dump>');
  process.exit(1);
}
try { console.log(JSON.stringify(verifyBackup(file), null, 2)); }
catch (error) { console.error(`Backup verification failed: ${error.message}`); process.exitCode = 1; }
