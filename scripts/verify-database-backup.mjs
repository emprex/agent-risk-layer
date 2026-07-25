#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyBackup } from './backup-database.mjs';
const file=process.argv[2];if(!file){console.error('Usage: node scripts/verify-database-backup.mjs <backup.sqlite>');process.exit(1)}
try{const result=verifyBackup(file);if(result.quickCheck!=='ok')throw new Error(`SQLite quick_check returned ${result.quickCheck}`);const manifestFile=`${path.resolve(file)}.manifest.json`;let digest=null,manifestMatches=null;if(fs.existsSync(manifestFile)){const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');manifestMatches=digest===manifest.sha256;if(!manifestMatches)throw new Error('Backup checksum does not match its manifest.');}console.log(JSON.stringify({ok:true,quickCheck:result.quickCheck,tableCounts:result.tableCounts,sha256:digest,manifestMatches},null,2));}catch(error){console.error(`Backup verification failed: ${error.message}`);process.exitCode=1;}
