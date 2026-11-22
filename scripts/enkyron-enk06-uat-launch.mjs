#!/usr/bin/env node
// ENK-06 human UAT: launch the REAL native ENKYRON Qt UI against ONLY the
// separately created and seeded synthetic database. No arl_local fallback.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import pg from 'pg';
import {resolveEnkyronDatabase,ENKYRON_ENK06_UAT_DATABASE,
  ENKYRON_ENK06_UAT_MARKER,verifyEnkyronUatDatabase}
  from '../desktop/enkyron-uat-database.mjs';
import {inspectEnk06Preflight} from './enkyron-enk06-uat-preflight.mjs';
import {SYNTHETIC_IDS} from './enkyron-enk06-uat-seed.mjs';

const DB=ENKYRON_ENK06_UAT_DATABASE;
const MARKER=ENKYRON_ENK06_UAT_MARKER;
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const NAME='ENK06 Synthetic Demo Company — NOT REAL';
export function validateEnk06LaunchEnv(env){
  if((env.ENKYRON_UAT_DATABASE && env.ENKYRON_UAT_DATABASE!==DB) ||
      (env.ENKYRON_UAT_GUARD && env.ENKYRON_UAT_GUARD!==MARKER) ||
      Object.hasOwn(env,'ENKYRON_UX_PREVIEW_READ_ONLY') ||
      env.QT_QPA_PLATFORM==='offscreen')
    throw Error('Refusing ENK-06 launch: conflicting UAT/preview/headless environment');
  return {database:DB,guard:MARKER};
}
// This query is also parsed against real PostgreSQL in CI, so a UUID/TEXT
// mismatch cannot slip through a mock-based launcher test.
export const SYNTHETIC_SEED_READBACK_SQL =
    'SELECT '+
    '(SELECT count(*)::int FROM enkyron_crm_companies '+
    'WHERE workspace_key=$1 AND id=$2 AND name=$3) AS company,'+
    '(SELECT count(*)::int FROM enkyron_crm_effective_ticket_links '+
    'WHERE workspace_key=$1 AND company_id=$2 AND ticket_id=$4) AS ticket,'+
    '(SELECT count(*)::int FROM enkyron_mail_local_threads '+
    "WHERE workspace_key=$1 AND mailbox_key='direction' AND thread_id=$5 "+
    "AND crm_company_id::text=$2 AND folder_key='inbox') AS thread,"+
    '(SELECT count(*)::int FROM enkyron_mail_attachment_quarantine '+
    "WHERE workspace_key=$1 AND mailbox_key='direction' "+
    'AND attachment_id=$6 AND message_id=$7 '+
    "AND safety_state='quarantined_unscanned' "+
    'AND content_sha256 IS NOT NULL AND content_bytes IS NOT NULL) AS attachment,'+
    '(SELECT count(*)::int FROM enkyron_local_mail_access '+
    "WHERE workspace_key=$1 AND mailbox_key='direction' "+
    "AND role='organization_owner_l5' AND can_read=true "+
    'AND can_send=false) AS access,'+
    '(SELECT count(*)::int FROM enkyron_local_mail_access '+
    "WHERE workspace_key=$1 AND mailbox_key='support' "+
    "AND role='organization_owner_l5' AND can_read=true "+
    'AND can_send=false) AS support_access';

export async function verifySyntheticSeed(pool,actor,{allowMissingSupport=false}={}){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Refusing ENK-06 launch: invalid peer identity');
  const key='local:'+actor,ids=SYNTHETIC_IDS;
  const row=(await pool.query(
    SYNTHETIC_SEED_READBACK_SQL,
    [key,ids.company_id,NAME,ids.ticket_id,ids.thread_id,
      ids.attachment_id,ids.message_id]
  )).rows[0];
  if(!row||['company','ticket','thread','attachment','access']
      .some(k=>row[k]!==1) ||
      (!allowMissingSupport && row.support_access!==1))
    throw Error('Refusing ENK-06 launch: expected synthetic seed missing or invalid');
  return {verified:true,company:ids.company_id,ticket:ids.ticket_id,
    thread:ids.thread_id,provider_disabled:true,
    support_ready:row.support_access===1};
}
const PYTHON=`from PySide6.QtWidgets import QApplication
from desktop.enkyron import EnkyronWindow, STYLE
app = QApplication([])
app.setApplicationName("ENKYRON SYNTHETIC UAT-06")
app.setStyle("Fusion")
app.setStyleSheet(STYLE)
window = EnkyronWindow()
window.setWindowTitle("ENKYRON · SYNTHETIC UAT-06 · NO REAL DATA")
window.show()
window.navigation.setCurrentRow(3)
raise SystemExit(app.exec())
`;
export async function launch(){
  validateEnk06LaunchEnv(process.env);
  process.env.ENKYRON_UAT_DATABASE=DB;
  process.env.ENKYRON_UAT_GUARD=MARKER;
  const target=resolveEnkyronDatabase();
  if(!target.uat||target.database!==DB||target.marker!==MARKER)
    throw Error('Refusing ENK-06 launch: exact UAT target missing');
  const actor=os.userInfo().username;
  const pool=new pg.Pool({host:'/var/run/postgresql',port:5432,
    database:DB,user:actor,max:1,connectionTimeoutMillis:5000,
    options:'-c default_transaction_read_only=on -c statement_timeout=8000'});
  try{
    await inspectEnk06Preflight(pool,target);
    await verifyEnkyronUatDatabase(pool,target);
    await verifySyntheticSeed(pool,actor);
  }finally{await pool.end();}
  // Every child bridge call inherits the exact synthetic DB and marker.
  // Provider reads/sends are independently blocked by its command allowlist.
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',['-c',PYTHON],{
      cwd:ROOT,env:{...process.env},stdio:'inherit'
    });
    child.on('error',reject);
    child.on('exit',(code,signal)=>resolve({code,signal}));
  });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv.length!==2){
    console.error('ENK-06 synthetic launcher takes no arguments');
    process.exitCode=2;
  }else launch().then(({code,signal})=>{
    process.exitCode=signal?1:(code??1);
  }).catch(error=>{
    console.error('ENK-06 synthetic launch refused: '+String(error?.message||'unknown'));
    process.exitCode=1;
  });
}
