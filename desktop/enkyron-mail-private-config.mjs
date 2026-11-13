// Read-only credential loader for a single local Owner workstation.
// This is an interim manual API-key configuration, NOT OAuth.
// Never auto-create, export, print or send secrets to Qt, logs or Git.
import fs from 'node:fs/promises';
import {constants as C} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PRIVATE_ERROR='Private Resend connection is not configured';
export const DEFAULT_RESEND_CONFIG=path.join(
  os.homedir(),'.local','share','enkyron','mail','inbox-access-v1.json'
);
export async function loadPrivateResendConfig(location=DEFAULT_RESEND_CONFIG){
  if(typeof location!=='string'||!path.isAbsolute(location))
    throw new Error(PRIVATE_ERROR);
  const directory=path.dirname(location);
  let fh;
  try{
    const dir=await fs.lstat(directory);
    if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()
        ||(dir.mode&0o077)!==0)throw new Error(PRIVATE_ERROR);
    fh=await fs.open(location,C.O_RDONLY|C.O_NOFOLLOW);
    const st=await fh.stat();
    if(!st.isFile()||st.uid!==process.getuid()||st.nlink!==1
       ||(st.mode&0o777)!==0o600||st.size<20||st.size>2048)
      throw new Error(PRIVATE_ERROR);
    const raw=await fh.readFile({encoding:'utf8'});
    const value=JSON.parse(raw);
    if(value?.version!==1||typeof value.api_key!=='string'||
        !/^re_[a-zA-Z0-9_-]{20,256}$/.test(value.api_key)||
        !value.mailboxes||typeof value.mailboxes!=='object'||
        !UUID.test(value.mailboxes.direction)||!UUID.test(value.mailboxes.support)||
        value.mailboxes.direction.toLowerCase()===value.mailboxes.support.toLowerCase())
      throw new Error(PRIVATE_ERROR);
    return {
      mailboxes:{direction:value.mailboxes.direction,support:value.mailboxes.support},
      // The key stays server-side and is used only on GET-only Resend requests.
      credentialProvider:async()=>value.api_key,
    };
  }catch{
    throw new Error(PRIVATE_ERROR);
  }finally{await fh?.close();}
}
