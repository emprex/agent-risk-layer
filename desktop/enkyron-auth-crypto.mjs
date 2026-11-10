// ENKYRON UX-15B1B — local credential primitives, not a login provider.
// Do not import src/auth.js here: that module is coupled to the web server
// session/config DB. Reuse its Node crypto algorithms without web cookies.
// A verified principal must be resolved by a future trusted auth service;
// neither this module nor a profile string grants desktop permissions.
import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
const ALG='scrypt-enkyron-v1';
const N=16384, R=8, P=1;
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function validateEnkyronPassword(value){
  if(typeof value!=='string'||value.length<15)
    throw new Error('Passphrase must contain at least 15 characters');
  if(value.length>200)
    throw new Error('Passphrase must not exceed 200 characters');
  if(/[\u0000-\u001f\u007f-\u009f]/u.test(value))
    throw new Error('Passphrase must not contain control characters');
  if(!value.trim())
    throw new Error('Passphrase must not consist only of whitespace');
  return true;
}
function strictBuffer(str,length){
  if(typeof str!=='string'||!/^[A-Za-z0-9_-]+$/.test(str))return null;
  const buf=Buffer.from(str,'base64url');
  return buf.length===length&&buf.toString('base64url')===str?buf:null;
}
function constantEqual(a,b){
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export async function hashEnkyronPassword(password){
  validateEnkyronPassword(password);
  const salt=crypto.randomBytes(16);
  const derived=await scrypt(password,salt,64,{N,r:R,p:P,maxmem:64*1024*1024});
  return [ALG,N,R,P,salt.toString('base64url'),derived.toString('base64url')].join('$');
}
export async function verifyEnkyronPassword(password,stored){
  if(typeof password!=='string'||typeof stored!=='string'||password.length>200)return false;
  const parts=stored.split('$');
  if(parts.length!==6||parts[0]!==ALG||parts[1]!==String(N)
      ||parts[2]!==String(R)||parts[3]!==String(P))return false;
  const salt=strictBuffer(parts[4],16),expected=strictBuffer(parts[5],64);
  if(!salt||!expected)return false;
  try {
    const candidate=await scrypt(password,salt,64,{N,r:R,p:P,maxmem:64*1024*1024});
    return constantEqual(candidate,expected);
  }catch{return false;}
}
function encodeBase32(buf){
  let bits=0,value=0,out='';
  for(const byte of buf){
    value=(value<<8)|byte;bits+=8;
    while(bits>=5){out+=B32[(value>>>(bits-5))&31];bits-=5;}
  }
  if(bits)out+=B32[(value<<(5-bits))&31];
  return out;
}
function decodeBase32(input){
  if(typeof input!=='string'||!/^[A-Z2-7]{32}$/.test(input))
    throw new Error('Invalid TOTP secret');
  let bits=0,value=0;const bytes=[];
  for(const char of input){
    value=(value<<5)|B32.indexOf(char);bits+=5;
    if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}
  }
  if(bytes.length!==20)throw new Error('Invalid TOTP length');
  return Buffer.from(bytes);
}
export function createEnkyronTotpSecret(){
  return encodeBase32(crypto.randomBytes(20));
}
function totpAt(secret,counter){
  if(!Number.isSafeInteger(counter)||counter<0)return null;
  const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',decodeBase32(secret)).update(buf).digest();
  const idx=digest[19]&15;
  const number=((digest[idx]&127)<<24)|(digest[idx+1]<<16)|(digest[idx+2]<<8)|digest[idx+3];
  return String(number%1_000_000).padStart(6,'0');
}
// Return the matched counter for service-side atomic replay prevention.
// Caller MUST persist highest accepted counter and reject equal/lower.
export function matchEnkyronTotpCounter(secret,code,nowMs=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isFinite(nowMs)
      ||nowMs<0)return null;
  const counter=Math.floor(nowMs/30_000);
  let matched=null;
  try{
    for(const offset of [-1,0,1]){
      const step=counter+offset,expected=totpAt(secret,step);
      if(expected!==null&&constantEqual(Buffer.from(code),Buffer.from(expected)))
        matched=step;
    }
  }catch{return null;}
  return matched;
}
function requireKey(key){
  if(!Buffer.isBuffer(key)||key.length!==32)
    throw new Error('Expected 32-byte local encryption key');
}
function requireScope(scope){
  if(typeof scope!=='string'||!/^[a-zA-Z0-9_.:-]{3,200}$/.test(scope))
    throw new Error('Invalid credential scope');
}
export function encryptEnkyronTotpSecret(secret,key,scope){
  requireKey(key);requireScope(scope);decodeBase32(secret);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(scope));
  const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
}
export function decryptEnkyronTotpSecret(envelope,key,scope){
  requireKey(key);requireScope(scope);
  const parts=String(envelope||'').split('.');
  if(parts.length!==4||parts[0]!=='v1')throw new Error('Invalid encrypted credential');
  const iv=strictBuffer(parts[1],12),tag=strictBuffer(parts[2],16);
  const data=strictBuffer(parts[3],32);
  if(!iv||!tag||!data)throw new Error('Invalid encrypted credential');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from(scope));decipher.setAuthTag(tag);
  const secret=Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
  decodeBase32(secret);
  return secret;
}
export function generateEnkyronSessionToken(){
  return crypto.randomBytes(32).toString('base64url');
}
export function hashEnkyronSessionToken(token,key){
  requireKey(key);
  if(!strictBuffer(token,32))throw new Error('Invalid session token');
  return crypto.createHmac('sha256',key).update('enkyron-session-v1:').update(token).digest('hex');
}
