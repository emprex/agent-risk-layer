#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const host = '127.0.0.1', port = 4331;
const token = crypto.randomBytes(24).toString('hex');
const pool = new pg.Pool({
  host: '/var/run/postgresql',
  user: 'emprex',
  database: 'arl_local',
  max: 3,
  connectionTimeoutMillis: 4000,
  options: '-c default_transaction_read_only=on -c statement_timeout=8000'
});

const css = `
*{box-sizing:border-box}
body{margin:0;background:#edf2f6;color:#19344a;font:15px system-ui,sans-serif}
header{background:#102940;color:white;padding:23px 5vw}
header strong{letter-spacing:1px}
main{max-width:1200px;margin:auto;padding:35px 26px}
h1{font-size:34px;letter-spacing:-1px;margin:4px 0 8px}
.muted{color:#63788a}
.eyebrow{color:#33838c;font-size:12px;font-weight:800;letter-spacing:1.3px}
.filters{background:white;border:1px solid #d8e3ea;border-radius:14px;padding:18px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px;margin:26px 0}
label{display:block;font-size:12px;font-weight:700;color:#546c7b}
input,select{margin-top:7px;padding:12px;border:1px solid #cbd7e0;border-radius:8px;width:100%;font:inherit;background:#fff;color:#19344a}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:15px}
.card{width:100%;min-height:178px;background:white;text-align:left;border:1px solid #d8e3ea;border-radius:13px;padding:20px;cursor:pointer}
.card:hover,.card:focus{border-color:#2a919b}
h3{font-size:18px;margin:10px 0}
.card p{font-size:13px;line-height:1.5;max-height:55px;overflow:hidden;color:#586e7f}
.tag{display:inline-block;background:#e7f3f3;color:#266f72;padding:5px 8px;border-radius:6px;font-size:11px;font-weight:bold;margin:4px 5px 0 0}
.draft{background:#fff0d7;color:#94631b}
button{font:inherit}
.pages{display:flex;align-items:center;justify-content:space-between;margin:22px 0}
.pages button,.back{padding:10px 16px;border:1px solid #cbd9e1;background:white;border-radius:8px;cursor:pointer}
.pages button:disabled{opacity:.4;cursor:default}
.hidden{display:none}
.paper{background:white;border:1px solid #dae4ea;border-radius:14px;padding:28px;margin-top:18px}
.paper h2{font-size:27px}
.paper article{max-width:850px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.75 ui-monospace,monospace}
.notice{margin-top:25px;color:#657a8d;font-size:12px}
@media(max-width:800px){.filters{grid-template-columns:1fr}main{padding:24px 15px}}
`;

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARL Knowledge Explorer</title>
<style>${css}</style>
<header><strong>AGENTRISKLAYER</strong> &nbsp; / &nbsp; Engineering Knowledge</header>
<main>
<div id="browse">
<div class="eyebrow">ENGINEERING LIBRARY</div>
<h1>Explore technical knowledge</h1>
<p class="muted">Search by subject, category or linked security control. No document codes to memorise.</p>

<section class="filters">
<label>Search knowledge
<input id="q" type="search" placeholder="TCP, sockets, MCP, egress…" autocomplete="off">
</label>
<label>Category
<select id="category"><option value="">All categories</option></select>
</label>
<label>Security control
<select id="control"><option value="">All controls</option></select>
</label>
</section>

<p id="info" class="muted">Loading…</p>
<section id="cards" class="grid"></section>

<div class="pages">
<button id="prev" disabled>← Previous</button>
<span id="pg" class="muted"></span>
<button id="next" disabled>Next →</button>
</div>
</div>

<div id="detail" class="hidden">
<button id="back" class="back">← Back to library</button>
<section class="paper">
<div class="eyebrow">TECHNICAL KNOWLEDGE</div>
<h2 id="title"></h2>
<div id="tags"></div>
<article id="content"></article>
</section>
</div>

<p class="notice">
Local read-only PostgreSQL library.
Technical guidance is not assessment evidence or a PASS/FAIL decision.
</p>
</main>

<script>
const tok=new URLSearchParams(location.search).get('token');
const $=id=>document.getElementById(id);
let index=0,more=false,requestNo=0,timer;

const make=(tag,text,cls='')=>{
  const e=document.createElement(tag);
  e.textContent=text||'';
  e.className=cls;
  return e;
};

const api=async(path,params={})=>{
  const u=new URLSearchParams({...params,token:tok});
  const r=await fetch('/api/'+path+'?'+u,{cache:'no-store'});
  const x=await r.json();
  if(!r.ok)throw Error(x.error||'Request failed');
  return x;
};

function reset(){index=0;load()}

async function load(){
  const n=++requestNo;
  $('cards').replaceChildren();
  $('info').textContent='Searching…';

  try{
    const r=await api('search',{
      q:$('q').value.trim(),
      category:$('category').value,
      control:$('control').value,
      page:index
    });
    if(n!==requestNo)return;

    more=r.more;
    $('cards').replaceChildren();

    for(const s of r.items){
      const b=make('button','','card');
      b.type='button';
      b.append(
        make('div',s.id+' · v'+s.revision+' · '+s.category,'muted'),
        make('h3',s.title),
        make('p',s.excerpt)
      );
      b.append(make('span',s.status.toUpperCase(),
        'tag'+(s.status==='draft'?' draft':'')));

      for(const c of s.controls.slice(0,3))
        b.append(make('span',c,'tag'));

      b.addEventListener('click',()=>openSheet(s.id,s.revision));
      $('cards').append(b);
    }

    if(!r.items.length)
      $('cards').append(make('p','No articles found. Try another search term.','muted'));

    $('info').textContent=r.items.length+' article(s) shown';
    $('pg').textContent='Page '+(index+1);
    $('prev').disabled=index===0;
    $('next').disabled=!more;
  }catch(e){
    if(n===requestNo){
      $('info').textContent='Search failed: '+e.message;
      $('prev').disabled=$('next').disabled=true;
    }
  }
}

async function openSheet(id,revision){
  try{
    const s=await api('sheet',{id,revision});
    $('title').textContent=s.title;
    $('tags').replaceChildren();

    for(const t of [
      s.id,'v'+s.revision,s.category,s.status.toUpperCase(),
      'SHA-256 verified',...s.controls
    ])
      $('tags').append(make('span',t,'tag'+(t==='DRAFT'?' draft':'')));

    $('content').textContent=s.content_markdown;
    $('browse').classList.add('hidden');
    $('detail').classList.remove('hidden');
    window.scrollTo(0,0);
  }catch(e){
    $('info').textContent='Cannot open sheet: '+e.message;
  }
}

$('back').onclick=()=>{
  $('detail').classList.add('hidden');
  $('browse').classList.remove('hidden');
};

$('q').oninput=()=>{
  clearTimeout(timer);
  timer=setTimeout(reset,250);
};

$('category').onchange=reset;
$('control').onchange=reset;
$('prev').onclick=()=>{if(index>0){index--;load()}};
$('next').onclick=()=>{if(more){index++;load()}};

(async()=>{
  try{
    const [a,b]=await Promise.all([
      api('categories'),
      api('controls')
    ]);

    for(const s of a.categories){
      const o=make('option',s);
      o.value=s;
      $('category').append(o);
    }

    for(const s of b.controls){
      const o=make('option',s.id+' — '+s.title);
      o.value=s.id;
      $('control').append(o);
    }

    load();
  }catch(e){
    $('info').textContent='Database unavailable: '+e.message;
  }
})();
</script>
</html>`;

function send(res,status,body,type='application/json; charset=utf-8'){
  res.writeHead(status,{
    'Content-Type':type,
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  });
  res.end(type.startsWith('application/json')?JSON.stringify(body):body);
}

async function handle(req,res){
  try{
    if(req.socket.remoteAddress!=='127.0.0.1'||
       req.headers.host!==host+':'+port)
      return send(res,403,{error:'Local access only'});

    if(req.method!=='GET'||(req.url||'').length>2500)
      return send(res,405,{error:'GET only'});

    const u=new URL(req.url,'http://'+host+':'+port);

    if(u.searchParams.get('token')!==token)
      return send(res,403,{error:'Invalid session'});

    if(u.pathname==='/')
      return send(res,200,page,'text/html; charset=utf-8');

    if(u.pathname==='/api/categories'){
      const rows=(await pool.query(
        'SELECT DISTINCT category FROM technical_knowledge_sheets ORDER BY category'
      )).rows;
      return send(res,200,{categories:rows.map(x=>x.category)});
    }

    if(u.pathname==='/api/controls'){
      const rows=(await pool.query(
        'SELECT id,title FROM risk_knowledge_entries ORDER BY id'
      )).rows;
      return send(res,200,{controls:rows});
    }

    if(u.pathname==='/api/search'){
      const q=u.searchParams.get('q')||'';
      const cat=u.searchParams.get('category')||'';
      const ctl=u.searchParams.get('control')||'';
      const p=Number(u.searchParams.get('page')||0);

      if(q.length>120||cat.length>100||
         !Number.isSafeInteger(p)||p<0||p>10000||
         (ctl&&!/^ARL-KB-\d{3}$/.test(ctl)))
        return send(res,400,{error:'Invalid filter'});

      const filters=[],values=[];
      const bind=v=>{values.push(v);return '$'+values.length};

      if(q.trim())
        filters.push(
          `to_tsvector('english',s.title||' '||s.content_markdown) @@ websearch_to_tsquery('english',${bind(q.trim())})`
        );

      if(cat)filters.push(`s.category=${bind(cat)}`);

      if(ctl)
        filters.push(
          `EXISTS(SELECT 1 FROM technical_knowledge_control_links l WHERE l.sheet_id=s.id AND l.sheet_revision=s.revision AND l.control_id=${bind(ctl)})`
        );

      const sql=`
        SELECT s.id,s.revision,s.title,s.category,s.status,
        LEFT(s.content_markdown,240) AS excerpt,
        ARRAY(
          SELECT l.control_id
          FROM technical_knowledge_control_links l
          WHERE l.sheet_id=s.id AND l.sheet_revision=s.revision
          ORDER BY l.control_id
        ) AS controls
        FROM technical_knowledge_sheets s
        ${filters.length?'WHERE '+filters.join(' AND '):''}
        ORDER BY s.title,s.id,s.revision
        LIMIT ${bind(25)} OFFSET ${bind(p*24)}
      `;

      const rows=(await pool.query(sql,values)).rows;

      return send(res,200,{
        items:rows.slice(0,24),
        more:rows.length>24
      });
    }

    if(u.pathname==='/api/sheet'){
      const id=u.searchParams.get('id')||'';
      const rev=u.searchParams.get('revision')||'';

      if(!/^TECH-\d{3,9}$/.test(id)||
         !/^\d+\.\d+\.\d+$/.test(rev))
        return send(res,400,{error:'Invalid sheet'});

      const rows=(await pool.query(`
        SELECT s.*,
        ARRAY(
          SELECT l.control_id
          FROM technical_knowledge_control_links l
          WHERE l.sheet_id=s.id AND l.sheet_revision=s.revision
          ORDER BY l.control_id
        ) AS controls
        FROM technical_knowledge_sheets s
        WHERE s.id=$1 AND s.revision=$2
      `,[id,rev])).rows;

      if(!rows.length)
        return send(res,404,{error:'Sheet not found'});

      const s=rows[0];
      const hash=crypto.createHash('sha256')
        .update(s.content_markdown).digest('hex');

      if(s.content_digest!==hash)
        return send(res,409,{error:'Knowledge digest mismatch'});

      delete s.content_digest;
      return send(res,200,s);
    }

    return send(res,404,{error:'Not found'});
  }catch(e){
    console.error(e.message);
    return send(res,500,{error:'Knowledge query failed'});
  }
}

const server=http.createServer((req,res)=>{void handle(req,res)});

server.on('error',e=>{
  console.error('Cannot start explorer:',e.message);
  process.exitCode=1;
  void pool.end();
});

server.listen(port,host,async()=>{
  try{
    const r=await pool.query(
      'SELECT count(*)::int AS total FROM technical_knowledge_sheets'
    );

    const url='http://'+host+':'+port+'/?token='+token;

    console.log('ARL Knowledge Explorer: '+r.rows[0].total+' sheet(s)');
    console.log('Open: '+url);
    console.log('Press Ctrl+C to stop.');

    if(process.env.DISPLAY||process.env.WAYLAND_DISPLAY){
      const c=spawn('xdg-open',[url],{
        detached:true,
        stdio:'ignore'
      });
      c.on('error',()=>{});
      c.unref();
    }
  }catch(e){
    console.error('PostgreSQL unavailable:',e.message);
    server.close();
    await pool.end();
    process.exitCode=1;
  }
});

process.once('SIGINT',()=>{
  server.close();
  void pool.end().finally(()=>process.exit(0));
});
