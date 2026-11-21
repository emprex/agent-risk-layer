#!/usr/bin/env node
import {resolveEnkyronDatabase} from "./enkyron-uat-database.mjs";
// Generic, manifest-driven ENKYRON security-test catalogue/dispatcher.
// Only adapters in ALLOWED_ADAPTERS may execute; manifests cannot inject commands.
// No UI-specific customer IDs, frozen SHA, or test names are embedded here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLinkedAssessmentContext } from './enkyron-ticket-assessment.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAT_DIR = path.join(HERE, 'security-test-catalog');
const ALLOWED_ADAPTERS = Object.freeze({
  'louvain-ask-warning-propagation-v1': 'enkyron-f01-cli.mjs',
});
const ID = /^[a-z][a-z0-9-]{4,79}$/;
const CONTROL = /^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const TICKET = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_ID = /^prj_[A-Za-z0-9_-]{8,100}$/;
const SIMPLIFIED = /^[A-Za-z0-9 _.,:;/()→+—-]{1,260}$/;
const err = (message) => { throw new Error(message); };

function catalogue() {
  const entries = fs.readdirSync(CAT_DIR, {withFileTypes:true})
    .filter(e => e.isFile() && /^[a-z0-9-]+\.v\d+\.json$/.test(e.name));
  if (entries.length > 3000) err('Catalog exceeds the local safety limit');
  const seen = new Set();
  return entries.map(e => {
    const pathname = path.join(CAT_DIR, e.name);
    if (fs.statSync(pathname).size > 16000) err('Oversize test definition');
    const m = JSON.parse(fs.readFileSync(pathname, 'utf8'));
    if(m?.schema !== 'arl.security-test-definition.v1' || !ID.test(m.test_id) ||
       seen.has(m.test_id) || !CONTROL.test(m.control_id) ||
       typeof m.name !== 'string' || m.name.length > 140 ||
       !SIMPLIFIED.test(m.name) || !ID.test(m.adapter) ||
       !Object.hasOwn(ALLOWED_ADAPTERS, m.adapter) ||
       m.target?.kind !== 'git' || typeof m.target.package_name !== 'string' ||
       !/^[a-z@][a-z0-9._/@-]{0,100}$/.test(m.target.package_name) ||
       !Array.isArray(m.target.required_files) || m.target.required_files.length < 1 ||
       m.target.required_files.length > 24 ||
       !m.target.required_files.every(p => typeof p === 'string' &&
         /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(p) &&
         !p.split('/').includes('..')) ||
       typeof m.scope !== 'string' || m.scope.length > 600 ||
       typeof m.expected !== 'string' || m.expected.length > 600)
      err('Invalid or conflicting test definition');
    seen.add(m.test_id);
    return m;
  });
}
function targetSupports(target, manifest) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));
    if(packageJson.name !== manifest.target.package_name)return false;
    return manifest.target.required_files.every(p => fs.statSync(path.join(target,p)).isFile());
  } catch {return false;}
}
function safeTest(m) {
  return {test_id:m.test_id, name:m.name, control_id:m.control_id,
    category:m.category.slice(0,100),scope:m.scope,expected:m.expected,
    registration:m.registration.slice(0,300)};
}
async function dispatch(op,ticket,testId,artifactDigest) {
  if(!['list','run','record'].includes(op) || !TICKET.test(ticket||''))
    err('Invalid test operation or ticket ID');
  if(op !== 'list' && !ID.test(testId||''))err('Select an offered test ID');
  const pool = new pg.Pool({host:'/var/run/postgresql', port:5432,database:resolveEnkyronDatabase().database,
    user:os.userInfo().username,connectionTimeoutMillis:5000,max:1});
  try {
    // Exact assessment and frozen target binding are verified by the canonical module.
    const scope = await readLinkedAssessmentContext(pool,ticket);
    if(!scope?.available || !PROJECT_ID.test(scope.project_id||'') ||
       !/^[a-f0-9]{40}$/.test(scope.target_sha||'')) err('Verified assessment unavailable');
    const matching = catalogue().filter(m=>targetSupports(scope.target_reference,m));
    if(op === 'list') {
      return {available:true, schema:'arl.security-test-catalog.v1',
        ticket_id:ticket,assessment_id:scope.assessment_id,
        snapshot_id:scope.snapshot_id,target_sha:scope.target_sha,
        tests:matching.map(safeTest),
        notice:matching.length ? 'Only supported local tests are offered; each needs operator confirmation.' :
          'No active test adapter matches this target yet. No test was executed.'};
    }
    const m=matching.find(x=>x.test_id === testId);
    if(!m)err('Selected test is unavailable for this verified target');
    if(op === 'record' && !SHA256.test(artifactDigest||''))err('Invalid evidence digest');
    const adapter = path.join(HERE,ALLOWED_ADAPTERS[m.adapter]);
    if(!fs.statSync(adapter).isFile())err('Approved test adapter unavailable');
    // Adapter is separately scoped and independently validates ticket and SHA.
    // This dispatcher never constructs a shell command from manifest content.
    let stdout;
    try {
      stdout=execFileSync(process.execPath,[adapter,op,ticket,...(op === 'record'?[artifactDigest]:[])],{
        cwd:path.dirname(HERE),encoding:'utf8',timeout:40000,maxBuffer:65536,
        stdio:['ignore','pipe','pipe'],
      });
    } catch (e) {
      if(e.killed || e.signal)err('Test adapter exceeded its safety deadline; check canonical history before retrying');
      // Do not expose raw stderr, exception payloads, or private paths.
      let message='Test adapter refused or failed; no result inferred';
      try {const parsed=JSON.parse(String(e.stdout||'').trim());
        if(parsed?.ok===false && typeof parsed.error==='string' &&
          /^[a-zA-Z0-9 _.,:;/()→+—'-]{1,250}$/.test(parsed.error))message=parsed.error;
      }catch{}
      err(message);
    }
    let result;
    try{ result=JSON.parse(stdout.trim()); }catch{err('Adapter returned invalid JSON');}
    if(!result || result.ok === false ||
       (op==='run' && (result.test_run !== true || !SHA256.test(result.artifact_sha256||''))) ||
       (op==='record' && (result.recorded !== true || !result.test_id || !result.evidence_id)) ||
       result.target_sha !== scope.target_sha || result.snapshot_id !== scope.snapshot_id)
      err('Adapter result failed scope or output validation');
    return { ...result,test_id_catalog:m.test_id,control_id:m.control_id,
      authorised_test_only:true,
      reminder:'Synthetic test results do not imply a confirmed security finding or release approval.'};
  } finally {await pool.end().catch(()=>{});}
}
const [op,ticket,testId,digest]=process.argv.slice(2);
try{console.log(JSON.stringify(await dispatch(op,ticket,testId,digest)));}
catch(e){console.log(JSON.stringify({ok:false,error:String(e?.message||'Test operation failed').slice(0,220)}));process.exitCode=1;}
