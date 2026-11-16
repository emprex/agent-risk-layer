// ENKYRON: checksum-verified outbound attachment payloads.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{32}$/i;
const HASH=/^[0-9a-f]{64}$/i;
const BASE=path.join(
  process.env.XDG_DATA_HOME||
    path.join(os.homedir(),'.local','share'),
  'enkyron','outgoing-attachments'
);

export async function outgoingAttachmentsForDraft(draftId){
  if(typeof draftId!=='string'||!UUID.test(draftId))
    throw Error('CRM invalid draft attachment key');

  const folder=path.join(BASE,draftId);
  let directory;
  try{
    directory=await fs.lstat(folder);
  }catch(e){
    if(e.code==='ENOENT')return [];
    throw e;
  }

  if(!directory.isDirectory()||directory.isSymbolicLink())
    throw Error('CRM unsafe attachment folder');

  const manifest=path.join(folder,'manifest.json');
  const stat=await fs.lstat(manifest);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)
    throw Error('CRM invalid attachment manifest');

  let rows;
  try{
    rows=JSON.parse(await fs.readFile(manifest,'utf8')).files;
  }catch{
    throw Error('CRM invalid attachment manifest');
  }
  if(!Array.isArray(rows)||rows.length>8)
    throw Error('CRM invalid attachment list');

  const result=[];
  let total=0;
  for(const x of rows){
    if(!HEX.test(x?.id||'')||!HASH.test(x?.sha256||'')||
       typeof x.filename!=='string'||x.filename.length>160||
       /[\\/\r\n\x00-\x1f]/.test(x.filename)||
       !Number.isSafeInteger(x.size)||x.size<1||
       x.size>10*1024*1024)
      throw Error('CRM invalid attachment metadata');

    total+=x.size;
    if(total>12*1024*1024)
      throw Error('CRM attachments exceed 12 MB');

    const file=path.join(folder,x.id+'.blob');
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||
       stat.size!==x.size)
      throw Error('CRM attachment changed');

    const bytes=await fs.readFile(file);
    if(bytes.length!==x.size||
       createHash('sha256').update(bytes).digest('hex')!==x.sha256)
      throw Error('CRM attachment checksum mismatch');

    result.push({
      filename:x.filename,
      content:bytes.toString('base64')
    });
  }
  return result;
}
