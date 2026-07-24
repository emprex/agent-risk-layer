#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function backupDatabase(sourcePath, destinationPath) {
  const source=path.resolve(sourcePath);const destination=path.resolve(destinationPath);
  if(!fs.existsSync(source))throw new Error(`Database not found: ${source}`);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if(fs.existsSync(destination))throw new Error(`Refusing to overwrite existing backup: ${destination}`);
  const db=new DatabaseSync(source);
  try{db.exec('PRAGMA wal_checkpoint(FULL);');db.exec(`VACUUM INTO '${destination.replaceAll("'","''")}'`);}finally{db.close();}
  const verification=verifyBackup(destination);
  const manifest={schema:'arl.database.backup.v1',source,destination,createdAt:new Date().toISOString(),bytes:fs.statSync(destination).size,sha256:sha256File(destination),quickCheck:verification.quickCheck,tableCounts:verification.tableCounts};
  fs.writeFileSync(`${destination}.manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});return manifest;
}
export function verifyBackup(filePath){const file=path.resolve(filePath);const db=new DatabaseSync(file,{readOnly:true});try{const quickCheck=db.prepare('PRAGMA quick_check').get();const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();const tableCounts={};for(const {name} of tables){if(!/^[A-Za-z0-9_]+$/.test(name))continue;tableCounts[name]=db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count;}return{quickCheck:Object.values(quickCheck)[0],tableCounts};}finally{db.close();}}
export function rotateBackups(directory, retentionDays=30){const cutoff=Date.now()-Math.max(1,Number(retentionDays))*86400000;let removed=0;if(!fs.existsSync(directory))return{removed};for(const name of fs.readdirSync(directory)){if(!/\.sqlite(?:\.manifest\.json)?$/.test(name))continue;const file=path.join(directory,name);if(fs.statSync(file).mtimeMs<cutoff){fs.rmSync(file,{force:true});removed+=1;}}return{removed};}
function sha256File(file){const hash=crypto.createHash('sha256');hash.update(fs.readFileSync(file));return hash.digest('hex');}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){const source=process.env.DATABASE_PATH||'./data/agent-risk-layer.sqlite';const stamp=new Date().toISOString().replace(/[:.]/g,'-');const destination=process.argv[2]||`./data/backups/agent-risk-layer-${stamp}.sqlite`;try{const manifest=backupDatabase(source,destination);manifest.rotation=rotateBackups(path.dirname(path.resolve(destination)),Number(process.env.BACKUP_RETENTION_DAYS||30));console.log(JSON.stringify(manifest,null,2));}catch(error){console.error(`Backup failed: ${error.message}`);process.exitCode=1;}}
