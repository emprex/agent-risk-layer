import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  hashEnkyronPassword, verifyEnkyronPassword,
  createEnkyronTotpSecret, matchEnkyronTotpCounter,
  encryptEnkyronTotpSecret, decryptEnkyronTotpSecret,
  generateEnkyronSessionToken, hashEnkyronSessionToken,
} from '../desktop/enkyron-auth-crypto.mjs';

test('UX-15B1B password digests use salted scrypt, never plaintext and reject wrong credentials',async()=>{
  const secret='A correct horse battery staple for testing';
  const a=await hashEnkyronPassword(secret),b=await hashEnkyronPassword(secret);
  assert.notEqual(a,b);
  assert.ok(!a.includes(secret));
  assert.equal(await verifyEnkyronPassword(secret,a),true);
  assert.equal(await verifyEnkyronPassword(secret,b),true);
  assert.equal(await verifyEnkyronPassword('incorrect phrase',a),false);
  for(const invalid of ['', 'short', '          ', '\n'.repeat(16), 'a'.repeat(201)])
    await assert.rejects(hashEnkyronPassword(invalid),/Password/);
  for(const invalid of ['', 'garbage', 'scrypt-enkyron-v1$1$8$1$x$y',
    a.slice(0,-4)+'xxxx', a+'extra'])
    assert.equal(await verifyEnkyronPassword(secret,invalid),false);
});

test('UX-15B1B TOTP validates a time window and exposes a counter for replay prevention',()=>{
  const key=createEnkyronTotpSecret();
  assert.match(key,/^[A-Z2-7]{32}$/);
  assert.notEqual(createEnkyronTotpSecret(),key);
  const code=(step)=>{
    const counter=Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits=0,value=0;const bytes=[];
    for(const c of key){value=(value<<5)|alphabet.indexOf(c);bits+=5;
      if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
    const digest=crypto.createHmac('sha1',Buffer.from(bytes)).update(counter).digest();
    const offset=digest[19]&15;
    const v=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
    return String(v%1_000_000).padStart(6,'0');
  };
  const now=1_900_000_000_000,step=Math.floor(now/30_000),otp=code(step);
  assert.equal(matchEnkyronTotpCounter(key,otp,now),step);
  assert.equal(matchEnkyronTotpCounter(key,otp,now+100_000),null);
  assert.equal(matchEnkyronTotpCounter(key,'abc123',now),null);
  assert.equal(matchEnkyronTotpCounter('INVALID','123456',now),null);
  // The service must atomically reject reuse of the returned counter.
});

test('UX-15B1B AES-GCM protects TOTP credentials and binds ciphertext to principal scope',()=>{
  const key=crypto.randomBytes(32),other=crypto.randomBytes(32);
  const secret=createEnkyronTotpSecret(),scope='org-A:human-1';
  const enc=encryptEnkyronTotpSecret(secret,key,scope);
  assert.ok(!enc.includes(secret));
  assert.equal(decryptEnkyronTotpSecret(enc,key,scope),secret);
  assert.throws(()=>decryptEnkyronTotpSecret(enc,key,'org-A:human-2'));
  assert.throws(()=>decryptEnkyronTotpSecret(enc,other,scope));
  const parts=enc.split('.');
  parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);
  assert.throws(()=>decryptEnkyronTotpSecret(parts.join('.'),key,scope));
  assert.throws(()=>encryptEnkyronTotpSecret(secret,Buffer.alloc(8),scope));
});

test('UX-15B1B session tokens are random, HMAC-hashed and cannot be substituted',()=>{
  const key=crypto.randomBytes(32);
  const one=generateEnkyronSessionToken(),two=generateEnkyronSessionToken();
  assert.match(one,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(one,two);
  assert.notEqual(hashEnkyronSessionToken(one,key),hashEnkyronSessionToken(two,key));
  assert.match(hashEnkyronSessionToken(one,key),/^[a-f0-9]{64}$/);
  assert.throws(()=>hashEnkyronSessionToken('untrusted',key));
  assert.notEqual(hashEnkyronSessionToken(one,key),hashEnkyronSessionToken(one,crypto.randomBytes(32)));
});
