#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HOST='127.0.0.1', PORT=4331, TOKEN=crypto.randomBytes(32).toString('hex');
const PRODUCT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config={host:'/var/run/postgresql',user:'emprex',database:'arl_local',max:4,connectionTimeoutMillis:5000};
const readDb=new pg.Pool({...config,options:'-c default_transaction_read_only=on -c statement_timeout=8000'});
const writeDb=new pg.Pool({...config,options:'-c statement_timeout=8000 -c lock_timeout=3000'});
const uuid=()=>crypto.randomUUID();
const str=(v,n=500)=>typeof v==='string' ? v.trim().slice(0,n) : '';
const valid=(v,n=500)=>typeof v==='string' && v.trim().length>0 && v.trim().length<=n;
const statuses=['new','scoping','in_progress','waiting','pending_review','resolved','closed'];
const transitions={new:['scoping','waiting'],scoping:['in_progress','waiting'],in_progress:['waiting','pending_review'],waiting:['scoping','in_progress'],pending_review:['in_progress','resolved','waiting'],resolved:['closed','in_progress'],closed:['in_progress']};
const kindSet=new Set(['git','mcp','api','file','other']);
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARL Workbench</title>
<style>
*{box-sizing:border-box}body{font:15px system-ui,sans-serif;color:#17314a;background:#edf2f6;margin:0}header{background:#102940;color:#fff;padding:19px 28px;display:flex;justify-content:space-between;align-items:center}header strong{letter-spacing:.6px}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid #cad9e3;border-radius:8px;background:#fff;padding:9px 13px;color:#16364e}button:hover{background:#e8f2f5}button.primary{background:#146c7b;color:#fff;border-color:#146c7b}button:disabled{opacity:.45;cursor:not-allowed}main{display:grid;grid-template-columns:310px 1fr;min-height:calc(100vh - 65px)}aside{background:#fff;border-right:1px solid #d6e0e8;padding:21px;overflow:auto}.content{padding:27px;min-width:0;max-width:1200px;width:100%;margin:auto}h1{margin:4px 0 10px;font-size:27px}h2{margin:0 0 12px;font-size:20px}h3{margin:12px 0;font-size:16px}.muted{color:#657c8d}.small{font-size:12px}.box{background:#fff;border:1px solid #d7e3eb;border-radius:12px;padding:20px;margin:0 0 17px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}label{display:block;font-weight:650;font-size:12px;margin:8px 0}input,select,textarea{display:block;width:100%;padding:10px;border:1px solid #c8d7e0;border-radius:7px;background:#fff;color:#16364e;margin-top:6px}textarea{min-height:100px;resize:vertical}.ticket{display:block;width:100%;text-align:left;margin:8px 0;padding:12px;border:1px solid #dae4eb;border-radius:8px}.ticket.active{border-color:#138093;background:#eef8f9}.ticket b,.ticket small{display:block}.ticket small{margin-top:5px;color:#698090}.tag{display:inline-block;border-radius:5px;background:#e6eff4;padding:4px 7px;margin:3px;font-size:12px}.warn{background:#fff2dd;color:#915f21}.hidden{display:none!important}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.result{display:block;width:100%;text-align:left;padding:12px;margin:7px 0}.result b{display:block}.result small{color:#657c8d}.reader{white-space:pre-wrap;overflow-wrap:anywhere;max-height:410px;overflow:auto;background:#f2f6f8;border-radius:8px;padding:15px;font:13px/1.6 ui-monospace,monospace}.note{padding:12px 0;border-top:1px solid #e4edf1;white-space:pre-wrap;overflow-wrap:anywhere}.notice{color:#5c7285;font-size:12px;line-height:1.5}@media(max-width:800px){main{display:block}aside{border:0;border-bottom:1px solid #ddd}.grid{grid-template-columns:1fr}.content{padding:15px}}

.master-kbs {
  display:flex; flex-wrap:wrap; gap:7px;
  max-height:180px; overflow:auto; margin:12px 0
}
.master-kbs button {font-size:12px}
.master-kbs button.active {background:#146c7b;color:#fff}
.master-current {font-weight:700;margin:12px 0}

.master-md{white-space:normal;background:white;font:14px/1.7 system-ui;
max-height:600px;overflow:auto}
.master-md h2,.master-md h3,.master-md h4{margin:18px 0 8px}
.master-md p{margin:9px 0}
.master-md ul,.master-md ol{padding-left:25px}
.master-md li{margin:5px 0}
.master-md pre{white-space:pre-wrap;overflow-wrap:anywhere;
background:#eaf0f5;padding:13px;border-radius:7px}
.master-md code{background:#edf1f5;padding:2px 4px}
.master-md table{border-collapse:collapse;display:block;overflow-x:auto}
.master-md td,.master-md th{border:1px solid #d2dfe7;
padding:8px;text-align:left;vertical-align:top}
.master-md blockquote{border-left:3px solid #146c7b;
padding:10px;background:#eff6f6}
</style>
<header><strong>AGENTRISKLAYER / ASSESSMENT WORKBENCH</strong><span>Local · PostgreSQL</span></header>
<main><aside><button id="newBtn" class="primary">+ New Assessment Ticket</button><h3>My Tickets</h3><input id="ticketQuery" placeholder="Search ticket, client, target"><div id="tickets"></div><button id="moreBtn">Load more</button><h3>Existing ARL Assessments</h3><div id="existing" class="small muted">Loading…</div></aside>
<div class="content"><div id="messages" class="notice"></div>
<section id="newForm" class="box hidden"><h2>Open a new assessment ticket</h2><p class="notice">Planning record only. No target access, active test, approval or verified security assessment is created.</p>
<div class="grid"><label>Assessment title<input id="title" maxlength="160" placeholder="Agent / MCP security assessment"></label><label>Client organisation<input id="client" maxlength="160"></label><label>System owner / contact<input id="owner" maxlength="160"></label><label>Assigned engineer (declared)<input id="engineer" maxlength="120"></label><label>Target type<select id="kind"><option value="git">Git repository</option><option value="mcp">MCP server</option><option value="api">API / URL</option><option value="file">Local file / project</option><option value="other">Other</option></select></label><label>Target reference<input id="target" maxlength="700" placeholder="URL, local path, endpoint or identifier"></label></div>
<label>Scope and requested assessment<textarea id="scope" maxlength="4000"></textarea></label><label>Owner permission / ROE reference (recorded, not independently verified)<input id="permission" maxlength="500" placeholder="Leave blank until received"></label><label>Link an existing local ARL assessment (optional)<select id="linkProject"><option value="">New planning ticket — no canonical assessment yet</option></select></label>
<section id="masterPreview" class="hidden"><h3>Existing Master Dossier — read only</h3><p id="masterPreviewMeta" class="notice"></p><label>Master revision<select id="masterPreviewRev"></select></label><div id="masterPreviewDoc" class="reader"></div></section><div class="toolbar"><button id="createBtn" class="primary">Create numbered ticket</button><button id="cancelBtn">Cancel</button></div></section>
<section id="welcome" class="box"><h1>Assessments</h1><p>Open or resume a numbered ticket. Its scope, notes, citations and status are kept in PostgreSQL.</p><p class="notice">Security testing, evidence approval and deployment decisions remain in the canonical ARL assessment engine.</p></section>
<section id="workspace" class="hidden">
<div class="box"><div class="toolbar"><h1 id="ticketTitle"></h1><span id="ticketNumber" class="tag"></span></div><p id="ticketMeta" class="muted"></p><div id="ticketScope" class="reader"></div><p id="ticketPermission" class="notice"></p><p id="linked" class="notice"></p><section id="masterTicket" class="box hidden"><h3>Assessment Master Dossier — read only</h3><p id="masterTicketMeta" class="notice"></p><label>Master revision<select id="masterTicketRev"></select></label><div id="masterTicketNav" class="hidden">
<label>Find a control in this dossier
<input id="masterKBSearch" placeholder="KB-012, egress, credentials…">
</label>
<p id="masterKBCount" class="notice"></p>
<div id="masterKBList" class="master-kbs"></div>
<p id="masterKBTitle" class="master-current"></p>
<div class="toolbar">
<button id="masterCanonical">Read canonical KB</button><button id="masterNextKB">Next KB definition</button><button id="masterShowFull">View full dossier</button>
<button id="masterInsert" class="primary">Insert into Work Notes</button>
</div></div>
<div id="masterTicketDoc" class="reader"></div></section><div class="toolbar"><label>Status<select id="status"></select></label><button id="statusBtn">Update ticket status</button></div></div>
<div class="box"><h2>ARL Assistant — Knowledge guidance</h2><p class="notice">Find relevant technical sheets and canonical controls. This is deterministic search, NOT a connected MCP agent or an authorised test executor.</p><input id="knowledgeQuery" placeholder="Ask about TCP, MCP tools, injection, access control…"><div id="knowledgeResults"></div><section id="knowledgeDetail" class="hidden"><h3 id="knowledgeTitle"></h3><div id="knowledgeText" class="reader"></div><button id="insertBtn" class="primary">Insert reference into work notes</button></section></div>
<div class="box"><h2>ARL Operational Orchestrator — read-only</h2>
<p class="notice">Connected to the existing ARL assessment engine. Read-only status and control evidence index only. No active tests, approval, remediation or master revision. This is not a general-purpose command console.</p>
<div class="toolbar"><label style="min-width:170px">Control to inspect<input id="agentControl" maxlength="10" value="ARL-KB-014" spellcheck="false"></label><button id="agentRead" class="primary">Read assessment &amp; control state</button></div>
<div id="agentStatus" class="reader" role="status" aria-live="polite">Open a linked assessment ticket, then select Read assessment &amp; control state.</div></div>
<div class="box"><h2>Work Notes</h2><p class="notice">Append-only engineer notes. Referenced TECH/KB material is copied with its identifier, revision and source digest.</p><textarea id="noteBody" maxlength="12000" placeholder="Observations, evidence requests, analysis, client responses…"></textarea><p id="sourceInfo" class="notice">Source: manual note</p><button id="saveNote" class="primary">Save note to ticket</button><h3>History and notes</h3><div id="notes"></div><h3>Ticket activity</h3><div id="events"></div></div>
</section></div></main>
<script>
const token=new URLSearchParams(location.search).get('token');const $=id=>document.getElementById(id);let selected=null,selectedKnowledge=null,currentTicket=null,offset=0,timer=null;
const el=(tag,txt='',klass='')=>{const x=document.createElement(tag);x.textContent=txt;x.className=klass;return x};
async function api(path,body){const opts={headers:{'X-ARL-Session':token}};if(body!==undefined){opts.method='POST';opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}const r=await fetch('/api/'+path,opts);const json=await r.json();if(!r.ok)throw Error(json.error||'Request failed');return json}
function msg(v){$('messages').textContent=v}
function label(s){return s.replaceAll('_',' ').replace(/\\b\\w/g,c=>c.toUpperCase())}
async function listTickets(reset=false){try{if(reset){offset=0;$('tickets').replaceChildren()}const q=$('ticketQuery').value.trim();const r=await api('tickets?q='+encodeURIComponent(q)+'&offset='+offset);for(const t of r.items){const b=el('button','','ticket'+(t.id===selected?' active':''));b.append(el('b',t.ticket_number+' · '+t.title),el('small',t.client_name+' · '+label(t.status)));b.onclick=()=>openTicket(t.id);$('tickets').append(b)}offset+=r.items.length;$('moreBtn').classList.toggle('hidden',!r.more)}catch(e){msg(e.message)}}
async function listExisting(){try{const r=await api('existing');$('existing').replaceChildren();if(!r.items.length)$('existing').append(el('p','No locally bound existing assessments found.'));for(const p of r.items){const text=(p.assessment_name||p.name)+' · '+p.status;const b=el('button',text,'ticket');b.onclick=async()=>{if(p.linked_ticket_id){await openTicket(p.linked_ticket_id);return;}$('newBtn').click();$('linkProject').value=p.id;$('title').value=p.name;await loadMaster('preview',p.id);};$('existing').append(b);const o=el('option',text);o.value=p.id;$('linkProject').append(o)}}catch(e){$('existing').textContent='Lookup unavailable: '+e.message}}
$('newBtn').onclick=()=>{$('newForm').classList.remove('hidden');$('welcome').classList.add('hidden')};$('cancelBtn').onclick=()=>$('newForm').classList.add('hidden');
$('createBtn').onclick=async()=>{try{const body={title:$('title').value,client_name:$('client').value,system_owner:$('owner').value,assessor_name:$('engineer').value,target_kind:$('kind').value,target_reference:$('target').value,scope_text:$('scope').value,permission_reference:$('permission').value,linked_project_id:$('linkProject').value};const result=await api('create',body);$('newForm').classList.add('hidden');$('welcome').classList.add('hidden');$('ticketQuery').value='';await listTickets(true);await openTicket(result.id);msg('Ticket '+result.ticket_number+' created. No active security test was started.')}catch(e){msg('Creation refused: '+e.message)}};

// ARL_MASTER_VIEW_V1 — existing master, read-only.

// ARL_MASTER_NAV_V3 — read-only master control navigation.
function indexMaster(text) {
  const nl=String.fromCharCode(10),lines=text.split(nl);
  const kb=/^(#{2,4})[ ]+(ARL-KB-[0-9]{3})(?:[ ]|$)(.*)$/;
  const heading=/^(#{1,6})[ ]+/;
  const records=new Map();

  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(kb);
    if(!m)continue;

    let j=i+1;
    for(;j<lines.length;j++){
      if(lines[j].trim()==='---')break;
      const h=lines[j].match(heading);
      if(h&&(h[1].length<=m[1].length||kb.test(lines[j])))
        break;
    }

    const item=records.get(m[2])||{
      id:m[2],title:m[3].trim(),parts:[]
    };

    item.parts.push(lines.slice(i,j).join(nl).trim());
    records.set(m[2],item);
    i=j-1;
  }

  return Array.from(records.values()).map(x=>({
    id:x.id,
    title:x.title,
    body:x.parts.join(nl+nl)
  })).sort((a,b)=>a.id.localeCompare(b.id));
}

function showMasterControls(m) {
  const items=indexMaster(m.document_md);
  const search=$('masterKBSearch');
  const list=$('masterKBList');
  const title=$('masterKBTitle');
  const doc=$('masterTicketDoc');
  const full=$('masterShowFull');
  const insert=$('masterInsert');

  let active=items.at(-1)||null;
  let expanded=false;

  $('masterTicketNav').classList.remove('hidden');
  search.value='';

  function display(){
    title.textContent=expanded
      ?'Full master — revision '+m.revision
      :active?active.id+' — '+cleanMasterTitle(active.title)
      :'No documented controls';

    renderMasterDoc(doc,expanded||!active?m.document_md:active.body);

    full.textContent=expanded
      ?'View selected control':'View full dossier';

    insert.disabled=expanded||!active;
    doc.scrollTop=0;
  }

  function render(){
    const term=search.value.toLowerCase().trim();

    const found=items.filter(x=>
      (x.id+' '+x.title+' '+x.body)
      .toLowerCase().includes(term)
    );

    list.replaceChildren();

    $('masterKBCount').textContent=
      items.length+' documented controls; '+
      found.length+' matches. 108 in ARL catalogue.';

    for(const item of found){
      const btn=el(
        'button',
        item.id+' — '+cleanMasterTitle(item.title),
        item===active&&!expanded?'active':''
      );

      btn.onclick=()=>{
        active=item;
        expanded=false;
        render();
        display();
      };

      list.append(btn);
    }

    if(!found.length)
      list.append(el('span','No matching control','muted'));
  }


  $('masterCanonical').onclick=async()=>{
    if(!active)return;
    $('knowledgeQuery').value=active.id;
    await searchKnowledge();
    await openKnowledge({kind:'control',id:active.id});
    $('knowledgeDetail').scrollIntoView({block:'start'});
  };

  $('masterNextKB').onclick=async()=>{
    if(!active)return;
    const number=Number(active.id.slice(-3))+1;
    if(number>108)return;
    const id='ARL-KB-'+String(number).padStart(3,'0');
    $('knowledgeQuery').value=id;
    await searchKnowledge();
    await openKnowledge({kind:'control',id});
    $('knowledgeDetail').scrollIntoView({block:'start'});
  };
  search.oninput=render;

  full.onclick=()=>{
    expanded=!expanded;
    render();
    display();
  };

  insert.onclick=()=>{
    if(!selected||!active||expanded)return;

    const nl=String.fromCharCode(10);

    const ref='Source: '+m.dossier_key+
      ' | revision '+m.revision+
      ' | SHA-256 '+m.document_sha256+
      ' | '+active.id;

    const note=ref+nl+
      'Historical workpaper citation, not new assessment evidence.'+
      nl+nl+active.body+
      nl+nl+'Engineering observations:'+nl;

    const old=$('noteBody').value.trim();
    const combined=old?old+nl+nl+note:note;

    if(combined.length>12000){
      msg('Section too long for a note. Nothing inserted.');
      return;
    }

    $('noteBody').value=combined;
    selectedKnowledge=null;

    $('sourceInfo').textContent=
      'Source: manual note with referenced master revision';

    $('noteBody').focus();

    msg('Section inserted. Save note to ticket to persist it.');
  };

  render();
  display();
}

// ARL_MASTER_READER_V4 — safe, read-only Markdown rendering.
function renderMasterDoc(node, raw) {
  node.classList.add('master-md');
  node.replaceChildren();

  const nl=String.fromCharCode(10);
  const tick=String.fromCharCode(96);
  const lines=String(raw||'').split(nl);

  const add=(parent,tag,text)=>{
    const e=document.createElement(tag);
    e.textContent=text||'';
    parent.append(e);
    return e;
  };

  function inline(parent,text){
    String(text).split('**').forEach((part,i)=>{
      if(i%2){add(parent,'strong',part);return;}
      part.split(tick).forEach((v,j)=>{
        if(j%2)add(parent,'code',v);
        else parent.append(document.createTextNode(v));
      });
    });
  }

  const special=s=>/^#{1,6} /.test(s)||
    /^[-*] /.test(s)||/^[0-9]+\\. /.test(s)||
    s.startsWith('|')||s.startsWith('> ')||
    s.startsWith(tick.repeat(3))||s==='---';

  for(let i=0;i<lines.length;){
    const s=lines[i].trim();
    if(!s){i++;continue;}

    if(s.startsWith(tick.repeat(3))){
      const code=[];
      i++;
      while(i<lines.length &&
            !lines[i].trim().startsWith(tick.repeat(3)))
        code.push(lines[i++]);
      if(i<lines.length)i++;
      add(node,'pre',code.join(nl));
      continue;
    }

    const heading=s.match(/^(#{1,6}) (.*)$/);
    if(heading){
      const h=document.createElement(
        'h'+Math.min(5,Math.max(2,heading[1].length))
      );
      inline(h,heading[2]);
      node.append(h);
      i++;
      continue;
    }

    if(s==='---'){add(node,'hr','');i++;continue;}

    if(s.startsWith('> ')){
      const b=document.createElement('blockquote');
      inline(b,s.slice(2));
      node.append(b);
      i++;
      continue;
    }

    if(s.startsWith('|') && i+1<lines.length &&
       /^\\|?\\s*:?-{3,}/.test(lines[i+1].trim())){
      const table=document.createElement('table');
      const cells=x=>x.trim().replace(/^\\||\\|$/g,'')
        .split('|').map(v=>v.trim());

      const header=document.createElement('tr');
      for(const v of cells(s)){
        const th=document.createElement('th');
        inline(th,v);
        header.append(th);
      }
      table.append(header);
      i+=2;

      while(i<lines.length && lines[i].trim().startsWith('|')){
        const row=document.createElement('tr');
        for(const v of cells(lines[i])){
          const td=document.createElement('td');
          inline(td,v);
          row.append(td);
        }
        table.append(row);
        i++;
      }
      node.append(table);
      continue;
    }

    if(/^[-*] /.test(s)||/^[0-9]+\\. /.test(s)){
      const ordered=/^[0-9]+\\. /.test(s);
      const list=document.createElement(ordered?'ol':'ul');
      while(i<lines.length){
        const item=lines[i].trim();
        const match=item.match(
          ordered?/^[0-9]+\\. (.*)$/:/^[-*] (.*)$/
        );
        if(!match)break;
        const li=document.createElement('li');
        inline(li,match[1]);
        list.append(li);
        i++;
      }
      node.append(list);
      continue;
    }

    const paragraph=[];
    while(i<lines.length && lines[i].trim() &&
          (!paragraph.length||!special(lines[i].trim())))
      paragraph.push(lines[i++].trim());

    if(!paragraph.length){i++;continue;}
    const p=document.createElement('p');
    inline(p,paragraph.join(' '));
    node.append(p);
  }
}
function cleanMasterTitle(value){
  return String(value||'').replace(/^(?:\\s*[-—–]\\s*)+/, '');
}
async function loadMaster(mode, projectId, revision=''){
  const suffix=mode==='preview'?'Preview':'Ticket';
  const panel=$('master'+suffix);
  const meta=$('master'+suffix+'Meta');
  const revs=$('master'+suffix+'Rev');
  const doc=$('master'+suffix+'Doc');

  if(!projectId){
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  meta.textContent='Checking authoritative master binding…';
  doc.textContent='';

  try{
    const qs='project_id='+encodeURIComponent(projectId)+
      (revision?'&revision='+encodeURIComponent(revision):'');
    const r=await api('master?'+qs);

    if(mode==='preview' && $('linkProject').value!==projectId)return;
    if(mode!=='preview' &&
       currentTicket?.linked_project_id!==projectId)return;

    if(!r.available){
      meta.textContent='No existing master dossier found.';
      revs.replaceChildren();
      return;
    }

    const m=r.master;
    meta.textContent=[
      m.dossier_key+' · revision '+m.revision+' · '+m.record_type,
      'Project: '+m.project_name,
      'Snapshot: '+m.snapshot_id+
        ' ('+m.snapshot_version+', '+m.snapshot_status+')',
      'Target SHA: '+m.target_sha,
      'Document integrity: SHA-256 VERIFIED',
      'Recorded at: '+m.recorded_at,
      'Historical workpaper — not a new security assessment'
    ].join('\\n');

    revs.replaceChildren();

    for(const v of r.revisions){
      const o=el('option','Revision '+v.revision+' · '+v.recorded_at);
      o.value=String(v.revision);
      if(Number(v.revision)===Number(m.revision))o.selected=true;
      revs.append(o);
    }

    revs.onchange=()=>loadMaster(mode,projectId,revs.value);
    if(mode==='ticket')showMasterControls(m);
    else renderMasterDoc(doc,m.document_md);

  }catch(error){
    meta.textContent='Master lookup blocked: '+error.message;
    doc.textContent='';
    revs.replaceChildren();
  }
}

$('linkProject').onchange=()=>{
  void loadMaster('preview',$('linkProject').value);
};
async function openTicket(id){try{const v=await api('ticket?id='+encodeURIComponent(id));selected=id;currentTicket=v.ticket;selectedKnowledge=null;$('newForm').classList.add('hidden');$('welcome').classList.add('hidden');$('workspace').classList.remove('hidden');$('ticketTitle').textContent=v.ticket.title;$('ticketNumber').textContent=v.ticket.ticket_number;$('ticketMeta').textContent=v.ticket.client_name+' · Owner: '+v.ticket.system_owner+' · Engineer: '+v.ticket.assessor_name+' · '+v.ticket.target_kind+' · '+v.ticket.target_reference;$('ticketScope').textContent=v.ticket.scope_text;$('ticketPermission').textContent='Permission reference (unverified): '+(v.ticket.permission_reference||'Not provided');$('linked').textContent='Canonical ARL assessment: '+(v.ticket.linked_assessment_id||'Not linked — planning ticket only');await loadMaster('ticket',v.ticket.linked_project_id);$('status').replaceChildren();for(const s of v.allowed_statuses){const o=el('option',label(s));o.value=s;$('status').append(o)}$('statusBtn').disabled=!v.allowed_statuses.length;$('notes').replaceChildren();for(const n of v.notes){const d=el('div','','note');d.append(el('div',n.entered_by+' · '+n.created_at+' · '+(n.source_id||'Manual'),'muted small'),el('div',n.body));$('notes').append(d)}$('events').replaceChildren();for(const ev of v.events){$('events').append(el('p',ev.created_at+' · '+ev.event_type+' · '+ev.detail,'small muted'))}$('noteBody').value='';$('sourceInfo').textContent='Source: manual note';$('agentStatus').textContent='Select Read assessment & control state. No tests will run.';$('knowledgeDetail').classList.add('hidden');await searchKnowledge();await listTickets(true)}catch(e){msg('Ticket unavailable: '+e.message)}}
$('statusBtn').onclick=async()=>{try{await api('status',{id:selected,status:$('status').value});await openTicket(selected);msg('Ticket status updated. This is not a security verdict.')}catch(e){msg(e.message)}};
let searchSeq=0;
async function searchKnowledge(){const n=++searchSeq;if(!selected)return;const q=$('knowledgeQuery').value.trim();try{const r=await api('knowledge?q='+encodeURIComponent(q));if(n!==searchSeq)return;$('knowledgeResults').replaceChildren();if(!r.items.length)$('knowledgeResults').append(el('p','No matching knowledge found.','muted'));for(const x of r.items){const b=el('button','','result');b.append(el('b',x.title),el('small',x.kind.toUpperCase()+' · '+x.id+' · '+x.category));b.onclick=()=>openKnowledge(x);$('knowledgeResults').append(b)}}catch(e){msg(e.message)}}
$('knowledgeQuery').oninput=()=>{clearTimeout(timer);timer=setTimeout(searchKnowledge,260)};
async function openKnowledge(item){try{const x=await api('knowledge-item?type='+item.kind+'&id='+encodeURIComponent(item.id));selectedKnowledge=x;$('knowledgeTitle').textContent=x.title+' — '+x.id+' ('+x.revision+')';$('knowledgeText').textContent=x.body;$('knowledgeDetail').classList.remove('hidden')}catch(e){msg(e.message)}}
$('insertBtn').onclick=()=>{if(!selectedKnowledge)return;const x=selectedKnowledge;$('noteBody').value='Reference: '+x.id+' | revision: '+x.revision+' | digest: '+x.digest+'\\n\\n'+x.body.slice(0,9500)+'\\n\\nEngineering review / observations:\\n';$('sourceInfo').textContent='Source: '+x.kind+' '+x.id+' ('+x.revision+') — will be independently checked on save';$('noteBody').focus()};
$('saveNote').onclick=async()=>{try{const x=selectedKnowledge&&$('sourceInfo').textContent.startsWith('Source: '+selectedKnowledge.kind)?selectedKnowledge:null;await api('note',{ticket_id:selected,body:$('noteBody').value,source_type:x?.kind||'manual',source_id:x?.id||null});await openTicket(selected);msg(x?'Referenced note saved with structured source lineage.':'Manual note saved (source reference appears in body only).')}catch(e){msg('Cannot save note: '+e.message)}};
$('agentRead').onclick=async()=>{if(!selected||!currentTicket){msg('Select an assessment ticket first.');return;}const ticketId=selected;const controlId=$('agentControl').value.trim().toUpperCase();if(!/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/.test(controlId)){msg('Choose ARL-KB-001 through ARL-KB-108.');return;}$('agentRead').disabled=true;$('agentStatus').textContent='Reading the authoritative assessment and frozen target (no test will run)…';try{const r=await api('agent-status',{ticket_id:ticketId,control_id:controlId});if(ticketId!==selected)return;const c=r.control||{};const lines=['ARL OPERATIONAL ORCHESTRATOR — READ-ONLY','Ticket: '+r.ticketNumber,'Assessment: '+r.assessmentId,'Snapshot: '+r.snapshotId,'Frozen SHA: '+r.targetSha,'','Assessment workflow: '+(r.stage||'unknown'),'Next workflow action (not executed; separate authorisation required for tests): '+(r.nextAction||'none'),'Human review required: yes','','CONTROL: '+controlId,'Stage: '+(c.stage||'unknown'),'Chain status: '+(c.chainStatus||'unknown'),'Next action (not executed): '+(c.nextAction||'none'),'Evidence records: '+(c.evidenceCount??0),'Unverified evidence: '+(c.unverifiedEvidenceCount??0),'Test records: '+(c.testCount??0),'Open findings: '+(c.openFindingCount??0),
    '',
    'EVIDENCE INDEX (metadata only):',
    ...((c.evidenceIndex||[]).map(e=>[
      e.id||'unknown',e.verificationState||'unknown',
      e.retentionStatus||'unknown',e.sourceType||'unknown',
      'snapshot '+(e.systemSnapshotId||'unknown'),
      'test '+(e.testExecutionId||'none')
    ].join(' | '))),
    '',
    'TEST HISTORY (metadata only):',
    ...((c.testIndex||[]).map(t=>[
      t.id||'unknown',t.result||'unknown',
      t.executionKind||'unknown',
      'snapshot '+(t.systemSnapshotId||'unknown')
    ].join(' | '))),
    '',
    'GLOBAL WORKFLOW FOCUS: '+(r.workflowFocus||'not reported'),
    '',
    'ENGINE RESPONSE (status only):',r.answer||'No status narrative returned.','','The result is guidance, not proof or a PASS/FAIL decision. No data was written.'];lines.splice(lines.indexOf('GLOBAL WORKFLOW FOCUS: '+(r.workflowFocus||'not reported')),0,
'ENGINEERING GAPS:',...((c.review?.gaps||[]).map(x=>' - '+x)),'',
'EVIDENCE LIMITATIONS:',...((c.review?.evidence||[]).flatMap(e=>[
  (e.id||'unknown')+': '+(e.limitations||'not recorded'),
  '   Trust: '+(e.trustReason||'not recorded')
])),'',
'TEST LIMITATIONS:',...((c.review?.tests||[]).flatMap(t=>[
  (t.id||'unknown')+' | '+(t.method||'unknown method'),
  '   Limitation: '+(t.limitations||'not recorded'),
  '   Failure reason: '+(t.failureReason||'not recorded')
])),'');
$('agentStatus').textContent=lines.join('\\n');msg('Read-only ARL state loaded. No test performed and no master revision created.')}catch(e){if(ticketId===selected){$('agentStatus').textContent='Read-only request failed: '+e.message;msg('Orchestrator unavailable: '+e.message)}}finally{$('agentRead').disabled=false}};
$('ticketQuery').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>listTickets(true),260)};$('moreBtn').onclick=()=>listTickets();listExisting();listTickets(true);
</script></html>`;

function response(res,code,data,htmlResponse=false){res.writeHead(code,{
  'Content-Type':htmlResponse?'text/html; charset=utf-8':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
});res.end(htmlResponse?data:JSON.stringify(data))}
function fail(message,code=400){return Object.assign(new Error(message),{statusCode:code})}
async function bodyJson(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16000)throw fail('Request exceeds size limit',413)}try{return JSON.parse(text)}catch{throw fail('Invalid JSON')}}
async function transaction(fn){const c=await writeDb.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}
const refs=async(kind,id)=>{
  if(kind==='tech'){
    if(!/^TECH-\d{3,9}$/.test(id))throw fail('Invalid technical ID');
    const r=(await readDb.query('SELECT id,revision,title,category,content_markdown,content_digest FROM technical_knowledge_sheets WHERE id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0];
    if(!r)throw fail('Technical sheet not found',404);
    const d=crypto.createHash('sha256').update(r.content_markdown).digest('hex');
    if(d!==r.content_digest)throw fail('Technical sheet integrity mismatch',409);
    return {kind:'tech',id:r.id,revision:r.revision,title:r.title,category:r.category,digest:d,body:r.content_markdown};
  }
  if(kind==='control'){
    if(!/^ARL-KB-\d{3}$/.test(id))throw fail('Invalid control ID');
    const r=(await readDb.query(`SELECT e.id,e.title,e.category,e.knowledge_version,e.content_digest,e.problem_json,
      c.objective,c.method,c.required_evidence_json,c.pass_condition,c.fail_condition,c.limitations
      FROM risk_knowledge_entries e LEFT JOIN risk_knowledge_checks c ON c.entry_id=e.id
      WHERE e.id=$1 LIMIT 1`,[id])).rows[0];
    if(!r)throw fail('Control not found',404);
    let p={};let evidence=[];try{p=JSON.parse(r.problem_json||'{}');evidence=JSON.parse(r.required_evidence_json||'[]')}catch{throw fail('Stored control record invalid',409)}
    const b=[r.title,'\nProblem:\n'+(p.statement||'Not specified'),'\nObjective:\n'+(r.objective||'Not specified'),'\nAssessment method:\n'+(r.method||'Not specified'),'\nRequired evidence:\n'+evidence.map((x,i)=>(i+1)+'. '+x).join('\n'),'\nPASS condition:\n'+(r.pass_condition||'Not specified'),'\nFAIL condition:\n'+(r.fail_condition||'Not specified'),'\nLimitations:\n'+(r.limitations||'Not specified')].join('\n');
    return {kind:'control',id:r.id,revision:r.knowledge_version,title:r.title,category:r.category,digest:r.content_digest,body:b};
  }
  throw fail('Invalid knowledge source');
};

// ARL_WORKBENCH_ORCHESTRATOR_BRIDGE_V1 — isolated, fixed-command, non-provisioning.
// The product engine is called only for "Where are we?"; arbitrary operator
// prompts, automatic workflow continuation and active tests are excluded.
const READONLY_AGENT_CHILD = String.raw`// ARL_WORKBENCH_READ_ONLY_CHILD_V1
// This child receives only server-validated identity and one fixed status command.
// Never accept user-supplied free-form orchestration commands here.
const context=JSON.parse(process.env.ARL_WORKBENCH_READONLY_CONTEXT||'{}');
const productRoot=process.cwd();
process.env.ARL_LOCAL_MODE='1';
process.env.ARL_EXPECTED_TARGET_SHA=context.targetSha;
// The Workbench is bound to the existing local PostgreSQL socket, not a remote DB.
process.env.DATABASE_URL='postgresql://emprex@localhost/arl_local?host=/var/run/postgresql';
let db;
try {
  const {enableLocalCliMode}=await import('./src/agent/local-cli-mode.mjs');
  enableLocalCliMode(process.env);
  const [{runArlAgent},{getControlIntelligenceControl},database] = await Promise.all([
    import('./src/agent/arl-operational-orchestrator.mjs'),
    import('./src/control-intelligence.js'),
    import('./src/db.js')
  ]);
  db=database.db;
  const opts={projectId:context.projectId,userId:context.userId,assessmentId:context.assessmentId};
  const result=await runArlAgent(context.repositoryPath,'Where are we?',opts);
  const workflow=result?.canonicalData?.workflowState||{};
  // Do not return a successful status if the engine reports a different binding.
  const target=workflow?.authoritativeArtifacts?.frozenTarget;
  const boundRevision=String(target?.revision||'').toLowerCase();
  if(!boundRevision||boundRevision!==context.targetSha)throw Error('Frozen target revision changed');
  const assessmentContext=workflow?.authoritativeArtifacts?.assessmentContext;
  if(assessmentContext?.systemSnapshotId!==context.snapshotId)throw Error('Assessment snapshot binding changed');
  const detail=await getControlIntelligenceControl({...opts,controlId:context.controlId});
  const evidence=Array.isArray(detail?.evidence)?detail.evidence:[];
  const tests=Array.isArray(detail?.tests)?detail.tests:[];
  const findings=Array.isArray(detail?.findings)?detail.findings:[];
  const openFindings=findings.filter(f=>!['verified_closed','accepted_risk','invalidated_unsubstantiated'].includes(f.status));
  const output={
    workflowFocus:workflow?.scopedControl?.controlId||workflow?.nextAllowedAction?.controlId||null,
    stage:workflow?.stage||null,
    nextAction:workflow?.nextAllowedAction?.name||null,
    answer:typeof result?.answer==='string'?result.answer.slice(0,7000):null,
    control:{
      stage:detail?.chain?.currentStage||null,
      chainStatus:detail?.chain?.chainStatus||null,
      nextAction:detail?.chain?.nextAction||null,
      evidenceCount:evidence.length,
      unverifiedEvidenceCount:evidence.filter(e=>e.verificationState!=='verified').length,
      testCount:tests.length,
      openFindingCount:openFindings.length,
      evidenceIndex:evidence.map(e=>({
        id:e.id||null,
        sourceType:e.sourceType||null,
        verificationState:e.verificationState||null,
        retentionStatus:e.retentionStatus||null,
        systemSnapshotId:e.systemSnapshotId||null,
        testExecutionId:e.testExecutionId||null
      })),
      testIndex:tests.map(t=>({
        id:t.id||null,
        result:t.result||null,
        executionKind:t.executionKind||null,
        systemSnapshotId:t.systemSnapshotId||null,
        completedAt:t.completedAt||null
      }))
    }
  };
  // Review metadata only; no raw credential/source contents.
  output.control.review={
    gaps:(Array.isArray(detail?.chain?.missingRequirements)?detail.chain.missingRequirements:[])
      .map(x=>String(x).slice(0,250)).slice(0,12),
    evidence:evidence.map(e=>({
      id:e.id,
      limitations:String(e.limitations||'').slice(0,350),
      trustReason:String(e.trustReason||'').slice(0,350)
    })),
    tests:tests.map(t=>({
      id:t.id,
      method:String(t.executionMethod||'').slice(0,100),
      limitations:String(t.limitations||'').slice(0,350),
      failureReason:String(t.failureReason||'').slice(0,350)
    }))
  };
  process.stdout.write('ARL_READONLY_JSON:'+JSON.stringify(output)+'\n');
} catch(e) {
  process.stderr.write('ARL read-only inspection failed: '+String(e?.message||'unknown').slice(0,240)+'\n');
  process.exitCode=2;
} finally {
  if(db?.pool)await db.pool.end().catch(()=>{});
}
`;
const CONTROL_ID_PATTERN=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;

function targetRootFromTicket(ticket) {
  if(ticket.target_kind!=='git')throw fail('Read-only engine requires a linked Git target',409);
  const raw=str(ticket.target_reference,700);
  if(!raw||raw.includes('\\')||raw.includes('\0'))throw fail('Invalid local target path');
  const expanded=raw.startsWith('~/')?path.join(os.homedir(),raw.slice(2)):raw;
  if(!path.isAbsolute(expanded))throw fail('Target path must be absolute or start with ~/',409);
  let root;
  try{root=realpathSync(expanded)}catch{throw fail('Frozen target folder is missing',409)}
  if(!root.startsWith(os.homedir()+path.sep))throw fail('Target must be inside the local home directory',403);
  const digest=crypto.createHash('sha256').update(root).digest('hex');
  if(digest!==ticket.repository_identity_digest)throw fail('Ticket target differs from the canonical repository identity',409);
  return root;
}

async function getEngineBinding(ticketId) {
  const r=(await readDb.query(`
    SELECT t.id,t.ticket_number,t.target_kind,t.target_reference,t.linked_project_id,t.linked_assessment_id,
           p.created_by AS user_id,p.repository_identity_digest,
           m.target_sha,m.system_snapshot_id,m.document_md,m.document_sha256,
           s.status AS snapshot_status,s.assessment_configuration_json
    FROM arl_workbench_tickets t
    JOIN security_projects p ON p.id=t.linked_project_id AND p.agent_assessment_id=t.linked_assessment_id
    JOIN users u ON u.id=p.created_by AND u.email LIKE '%@local.invalid'
    JOIN LATERAL (
      SELECT target_sha,system_snapshot_id,document_md,document_sha256
      FROM assessment_master_dossier_revisions
      WHERE project_id=t.linked_project_id AND assessment_id=t.linked_assessment_id
      ORDER BY revision DESC,recorded_at DESC LIMIT 1
    ) m ON TRUE
    JOIN system_snapshots s ON s.id=m.system_snapshot_id AND s.project_id=p.id
    WHERE t.id=$1
  `,[ticketId])).rows[0];
  if(!r)throw fail('Ticket has no authoritative local assessment and master binding',409);
  if(r.snapshot_status!=='current')throw fail('Master references a non-current snapshot',409);
  if(!/^[a-f0-9]{40}$/.test(r.target_sha||''))throw fail('Invalid frozen target SHA',409);
  const digest=crypto.createHash('sha256').update(r.document_md,'utf8').digest('hex');
  if(digest!==r.document_sha256)throw fail('Master integrity mismatch',409);
  let config;
  try{config=typeof r.assessment_configuration_json==='string'?JSON.parse(r.assessment_configuration_json):r.assessment_configuration_json}catch{throw fail('Invalid snapshot configuration',409)}
  if(config?.assessmentBinding?.assessmentId!==r.linked_assessment_id||config?.targetBinding?.revision!==r.target_sha)throw fail('Master/snapshot identity mismatch',409);
  return {...r,repositoryPath:targetRootFromTicket(r)};
}

function runReadOnlyEngine(context) {
  return new Promise((resolve,reject)=>{
    let completed=false,stdout='',stderr='';
    const child=spawn(process.execPath,['--input-type=module','--eval',READONLY_AGENT_CHILD],{
      cwd:PRODUCT_ROOT,
      shell:false,
      stdio:['ignore','pipe','pipe'],
      env:{...process.env,ARL_WORKBENCH_READONLY_CONTEXT:JSON.stringify(context)}
    });
    const done=(err,value)=>{if(completed)return;completed=true;clearTimeout(timer);if(err)reject(err);else resolve(value)};
    const timer=setTimeout(()=>{child.kill('SIGKILL');done(fail('Read-only inspection timed out',503))},90000);
    child.on('error',()=>done(fail('Could not start the local assessment engine',503)));
    child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>150000){child.kill('SIGKILL');done(fail('Engine response exceeds safe limit',503))}});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-1500)});
    child.on('close',code=>{
      if(completed)return;
      if(code!==0){
        const diagnostic=stderr.match(/ARL read-only inspection failed: ([^\r\n]{1,240})/)?.[1]
          || stderr.match(/(?:Error|TypeError|ReferenceError):[^\r\n]{1,220}/)?.[0]
          || ('Engine process exited with '+(code===null?'a signal':'code '+code));
        const safe=diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi,'[database URL redacted]')
          .replace(/(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,'[credential redacted]');
        return done(fail('ARL read-only engine failed: '+safe.slice(0,240),503));
      }
      const marker='ARL_READONLY_JSON:';
      const pos=stdout.lastIndexOf(marker);
      if(pos<0)return done(fail('ARL engine returned no verified status',503));
      try {done(null,JSON.parse(stdout.slice(pos+marker.length).trim()))}
      catch {done(fail('ARL engine returned invalid status data',503))}
    });
  });
}

async function route(req,res){
  try{
    if(req.socket.remoteAddress!==HOST||req.headers.host!==HOST+':'+PORT)throw fail('Local access only',403);
    if((req.url||'').length>3000)throw fail('Invalid URL',414);
    const url=new URL(req.url,`http://${HOST}:${PORT}`);
    if(url.pathname==='/'&&req.method==='GET'){
      if(url.searchParams.get('token')!==TOKEN)throw fail('Invalid session',403);
      return response(res,200,html,true);
    }
    if(!url.pathname.startsWith('/api/'))throw fail('Not found',404);
    if(req.headers['x-arl-session']!==TOKEN)throw fail('Invalid session',403);
    if(!['GET','POST'].includes(req.method))throw fail('Method not allowed',405);
    if(req.method==='POST'&&(req.headers.origin!==`http://${HOST}:${PORT}`||!String(req.headers['content-type']||'').startsWith('application/json')))throw fail('Origin or content type rejected',403);
    const path=url.pathname.slice(5);
    if(req.method==='GET'&&path==='tickets'){
      const q=str(url.searchParams.get('q')||'',100),offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw fail('Invalid pagination');
      const items=(await readDb.query(`SELECT id,ticket_number,title,client_name,status FROM arl_workbench_tickets WHERE ($1='' OR ticket_number ILIKE $2 OR title ILIKE $2 OR client_name ILIKE $2 OR target_reference ILIKE $2) ORDER BY updated_at DESC,id LIMIT 31 OFFSET $3`,[q,'%'+q+'%',offset])).rows;
      return response(res,200,{items:items.slice(0,30),more:items.length>30});
    }
    if(req.method==='GET'&&path==='existing'){
      const items=(await readDb.query(`SELECT p.id,p.name,p.status,p.agent_assessment_id,a.name AS assessment_name,
        (SELECT t.id FROM arl_workbench_tickets t
         WHERE t.linked_project_id=p.id AND t.linked_assessment_id=p.agent_assessment_id
         ORDER BY t.created_at DESC LIMIT 1) AS linked_ticket_id
        FROM security_projects p JOIN users u ON u.id=p.created_by LEFT JOIN assessments a ON a.id=p.agent_assessment_id
        WHERE u.email LIKE '%@local.invalid' AND p.agent_assessment_id IS NOT NULL
        ORDER BY p.created_at DESC LIMIT 50`)).rows;
      return response(res,200,{items});
    }
    if(req.method==='GET'&&path==='ticket'){
      const id=url.searchParams.get('id');if(!/^[0-9a-f-]{36}$/.test(id||''))throw fail('Invalid ticket ID');
      const ticket=(await readDb.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',[id])).rows[0];
      if(!ticket)throw fail('Ticket not found',404);
      const notes=(await readDb.query('SELECT id,body,entered_by,created_at,source_type,source_id,source_revision FROM arl_workbench_notes WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[id])).rows;
      const events=(await readDb.query('SELECT event_type,detail,actor,created_at FROM arl_workbench_ticket_events WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[id])).rows;
      return response(res,200,{ticket,notes,events,allowed_statuses:transitions[ticket.status]||[]});
    }

    // ARL_MASTER_VIEW_V1 — verified historical master, read-only.
    if(req.method==='GET' && path==='master'){
      const projectId=url.searchParams.get('project_id')||'';
      const requested=url.searchParams.get('revision')||'';

      if(!/^prj_[a-zA-Z0-9_-]{8,100}$/.test(projectId)||
         (requested&&!/^[1-9][0-9]{0,7}$/.test(requested)))
        throw fail('Invalid master lookup');

      const project=(await readDb.query(`
        SELECT p.id,p.name,p.agent_assessment_id
        FROM security_projects p
        JOIN users u ON u.id=p.created_by
        WHERE p.id=$1
          AND p.agent_assessment_id IS NOT NULL
          AND u.email LIKE '%@local.invalid'
      `,[projectId])).rows[0];

      if(!project)
        throw fail('Existing local assessment not found',404);

      const selected=(await readDb.query(`
        SELECT dossier_key
        FROM assessment_master_dossier_revisions
        WHERE project_id=$1 AND assessment_id=$2
        ORDER BY recorded_at DESC,revision DESC
        LIMIT 1
      `,[projectId,project.agent_assessment_id])).rows[0];

      if(!selected)
        return response(res,200,{available:false});

      const versions=(await readDb.query(`
        SELECT revision,recorded_at
        FROM assessment_master_dossier_revisions
        WHERE dossier_key=$1
          AND project_id=$2
          AND assessment_id=$3
        ORDER BY revision DESC
        LIMIT 200
      `,[
        selected.dossier_key,
        projectId,
        project.agent_assessment_id
      ])).rows;

      if(!versions.length)
        throw fail('Master history unavailable',409);

      const revision=requested
        ?Number(requested)
        :Number(versions[0].revision);

      if(!versions.some(v=>Number(v.revision)===revision))
        throw fail('Requested master revision not found',404);

      const m=(await readDb.query(`
        SELECT
          m.dossier_key,m.revision,m.recorded_at,m.record_type,
          m.project_id,m.assessment_id,m.system_snapshot_id,
          m.target_sha,m.document_md,m.document_sha256,
          s.project_id AS snapshot_project_id,
          s.status AS snapshot_status,
          s.version_identifier AS snapshot_version,
          s.assessment_configuration_json
        FROM assessment_master_dossier_revisions m
        JOIN system_snapshots s
          ON s.id=m.system_snapshot_id
        WHERE m.dossier_key=$1
          AND m.project_id=$2
          AND m.assessment_id=$3
          AND m.revision=$4
      `,[
        selected.dossier_key,
        projectId,
        project.agent_assessment_id,
        revision
      ])).rows[0];

      if(!m)
        throw fail('Master snapshot binding unavailable',409);

      let configuration;
      try{
        configuration=
          typeof m.assessment_configuration_json==='string'
          ?JSON.parse(m.assessment_configuration_json)
          :m.assessment_configuration_json;
      }catch{
        throw fail('Invalid master snapshot configuration',409);
      }

      const bindingValid=
        project.agent_assessment_id===m.assessment_id &&
        m.project_id===m.snapshot_project_id &&
        configuration?.assessmentBinding?.assessmentId===m.assessment_id &&
        configuration?.targetBinding?.revision===m.target_sha;

      if(!bindingValid)
        throw fail('Master / assessment / snapshot / target mismatch',409);

      const digest=crypto.createHash('sha256')
        .update(m.document_md,'utf8')
        .digest('hex');

      if(digest!==m.document_sha256)
        throw fail('Master document integrity mismatch',409);

      return response(res,200,{
        available:true,
        revisions:versions,
        master:{
          dossier_key:m.dossier_key,
          revision:m.revision,
          recorded_at:m.recorded_at,
          record_type:m.record_type,
          project_name:project.name,
          snapshot_id:m.system_snapshot_id,
          snapshot_version:m.snapshot_version,
          snapshot_status:m.snapshot_status,
          target_sha:m.target_sha,
          document_md:m.document_md,
          document_sha256:digest,
          integrity:'verified'
        }
      });
    }
    if(req.method==='GET'&&path==='knowledge'){
      const q=str(url.searchParams.get('q')||'',120).trim();
      const techId=/^TECH-\d{3,9}$/i.test(q);
      const techWhere=q?(techId?'WHERE id=$1':"WHERE to_tsvector('english',title || ' ' || content_markdown) @@ websearch_to_tsquery('english',$1)") : '';
      const techParam=q?[techId?q.toUpperCase():q]:[];
      const a=(await readDb.query(`SELECT 'tech' AS kind,id,title,category FROM technical_knowledge_sheets ${techWhere} ORDER BY title LIMIT 20`,techParam)).rows;
      const controlWhere=q?'WHERE title ILIKE $1 OR id ILIKE $1 OR problem_json ILIKE $1':'';
      const b=(await readDb.query(`SELECT 'control' AS kind,id,title,category FROM risk_knowledge_entries ${controlWhere} ORDER BY title LIMIT 30`,q?['%'+q+'%']:[])).rows;
      return response(res,200,{items:[...a,...b].slice(0,35)});
    }
    if(req.method==='GET'&&path==='knowledge-item'){
      return response(res,200,await refs(url.searchParams.get('type'),url.searchParams.get('id')||''));
    }
    if(req.method==='POST'&&path==='create'){
      const x=await bodyJson(req);
      for(const [key,max] of [['title',160],['client_name',160],['system_owner',160],['assessor_name',120],['target_reference',700],['scope_text',4000]])if(!valid(x[key],max))throw fail(key+' is required (max '+max+' characters)');
      if(!kindSet.has(x.target_kind)||str(x.permission_reference,500).length!==(x.permission_reference||'').trim().length)throw fail('Invalid target type or permission reference');
      const p=str(x.linked_project_id||'',120);
      if(p){const found=(await readDb.query(`SELECT p.id,p.agent_assessment_id FROM security_projects p JOIN users u ON u.id=p.created_by WHERE p.id=$1 AND u.email LIKE '%@local.invalid' AND p.agent_assessment_id IS NOT NULL`,[p])).rows[0];if(!found)throw fail('Selected local assessment unavailable');x.linked_assessment_id=found.agent_assessment_id}
      const ticket=await transaction(async c=>{
        if(p){await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[p]);const previous=(await c.query('SELECT ticket_number FROM arl_workbench_tickets WHERE linked_project_id=$1 AND linked_assessment_id=$2 LIMIT 1',[p,x.linked_assessment_id])).rows[0];if(previous)throw fail('Existing linked ticket: '+previous.ticket_number+'. Open it from the left panel.',409)}
        const seq=(await c.query('SELECT nextval(\'arl_ticket_number_sequence\') AS n')).rows[0].n;
        const number=`ARL-${new Date().getUTCFullYear()}-${String(seq).padStart(6,'0')}`;
        const id=uuid(),actor=str(x.assessor_name,120);
        await c.query(`INSERT INTO arl_workbench_tickets (id,ticket_number,title,client_name,system_owner,target_kind,target_reference,scope_text,permission_reference,assessor_name,linked_project_id,linked_assessment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,number,str(x.title,160),str(x.client_name,160),str(x.system_owner,160),x.target_kind,str(x.target_reference,700),str(x.scope_text,4000),str(x.permission_reference,500),actor,p||null,x.linked_assessment_id||null]);
        await c.query('INSERT INTO arl_workbench_ticket_events(id,ticket_id,event_type,detail,actor) VALUES($1,$2,$3,$4,$5)',[uuid(),id,'created','Planning ticket opened; no active assessment executed',actor]);return {id,ticket_number:number};
      });return response(res,201,ticket);
    }
    if(req.method==='POST'&&path==='status'){
      const x=await bodyJson(req);if(!/^[0-9a-f-]{36}$/.test(x.id||'')||!statuses.includes(x.status))throw fail('Invalid status request');
      await transaction(async c=>{const r=(await c.query('SELECT status,assessor_name FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',[x.id])).rows[0];if(!r)throw fail('Ticket not found',404);if(!transitions[r.status].includes(x.status))throw fail('Status transition not allowed');await c.query('UPDATE arl_workbench_tickets SET status=$1,updated_at=NOW() WHERE id=$2',[x.status,x.id]);await c.query('INSERT INTO arl_workbench_ticket_events(id,ticket_id,event_type,detail,actor) VALUES($1,$2,$3,$4,$5)',[uuid(),x.id,'status_changed',r.status+' → '+x.status,r.assessor_name])});return response(res,200,{ok:true});
    }

    // This endpoint is restricted to the fixed, read-only status command.
    if(req.method==='POST'&&path==='agent-status'){
      const input=await bodyJson(req);
      if(!/^[0-9a-f-]{36}$/.test(input.ticket_id||'')||
         !CONTROL_ID_PATTERN.test(input.control_id||''))throw fail('Invalid ticket or control selection');
      const binding=await getEngineBinding(input.ticket_id);
      const result=await runReadOnlyEngine({
        repositoryPath:binding.repositoryPath,
        projectId:binding.linked_project_id,
        assessmentId:binding.linked_assessment_id,
        userId:binding.user_id,
        snapshotId:binding.system_snapshot_id,
        targetSha:binding.target_sha,
        controlId:input.control_id
      });
      return response(res,200,{
        ...result,
        ticketNumber:binding.ticket_number,
        assessmentId:binding.linked_assessment_id,
        snapshotId:binding.system_snapshot_id,
        targetSha:binding.target_sha
      });
    }
    if(req.method==='POST'&&path==='note'){
      const x=await bodyJson(req);if(!/^[0-9a-f-]{36}$/.test(x.ticket_id||'')||!valid(x.body,12000))throw fail('Ticket ID and note (max 12000 characters) required');
      const type=x.source_type||'manual';if(!['manual','tech','control'].includes(type))throw fail('Invalid note source');
      const source=type==='manual'?null:await refs(type,x.source_id||'');
      await transaction(async c=>{const t=(await c.query('SELECT assessor_name,status FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',[x.ticket_id])).rows[0];if(!t)throw fail('Ticket not found',404);if(t.status==='closed')throw fail('Reopen a closed ticket before adding notes');await c.query('INSERT INTO arl_workbench_notes(id,ticket_id,body,source_type,source_id,source_revision,source_digest,entered_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uuid(),x.ticket_id,str(x.body,12000),type,source?.id||null,source?.revision||null,source?.digest||null,t.assessor_name]);await c.query('INSERT INTO arl_workbench_ticket_events(id,ticket_id,event_type,detail,actor) VALUES($1,$2,$3,$4,$5)',[uuid(),x.ticket_id,'note_added',source?'Referenced '+source.id:'Manual work note',t.assessor_name]);await c.query('UPDATE arl_workbench_tickets SET updated_at=NOW() WHERE id=$1',[x.ticket_id])});return response(res,201,{ok:true});
    }
    throw fail('Not found',404);
  }catch(e){console.error('Workbench:',e.message);response(res,e.statusCode||500,{error:e.statusCode?e.message:'Internal error'})}
}
const server=http.createServer((req,res)=>{void route(req,res)});
server.on('error',e=>{console.error('Workbench start failed:',e.message);process.exitCode=1;void Promise.all([readDb.end(),writeDb.end()])});
server.listen(PORT,HOST,async()=>{
  try{const result=await readDb.query('SELECT count(*)::int AS n FROM arl_workbench_tickets');const url=`http://${HOST}:${PORT}/?token=${TOKEN}`;console.log('ARL Assessment Workbench · '+result.rows[0].n+' ticket(s)');console.log('Open: '+url);console.log('Ctrl+C to stop.');if(process.env.DISPLAY||process.env.WAYLAND_DISPLAY){const child=spawn('xdg-open',[url],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref()}}
  catch(e){console.error('Database startup failed:',e.message);server.close();await Promise.all([readDb.end(),writeDb.end()]);process.exitCode=1}
});
process.on('SIGINT',()=>{server.close();void Promise.all([readDb.end(),writeDb.end()]).then(()=>process.exit(0))});
