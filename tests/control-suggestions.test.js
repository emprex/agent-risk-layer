import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ARCHITECTURE_FACTS,SUGGESTION_PROFILE_DIGEST,SUGGESTION_PROFILE_VERSION,suggestControls,suggestionProfile} from '../src/control-suggestions.js';

const asset=JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'../risk-knowledge/risk-knowledge-v1.json'),'utf8'));
const entries=asset.entries.map(entry=>({id:entry.id,title:entry.title,category:entry.category,problem_json:JSON.stringify(entry.problem),content_digest:entry.content_digest}));

test('suggestion profile is versioned, deterministic and preserves all 108 canonical controls',()=>{
  assert.equal(SUGGESTION_PROFILE_VERSION,'ARL-SUGGEST-1.1.0');
  assert.match(SUGGESTION_PROFILE_DIGEST,/^[a-f0-9]{64}$/);
  assert.deepEqual(suggestionProfile(),suggestionProfile());
  const first=suggestControls(entries,ARCHITECTURE_FACTS,'snapshot-one'),second=suggestControls([...entries].reverse(),[...ARCHITECTURE_FACTS].reverse(),'snapshot-one');
  assert.equal(first.length,108);
  assert.deepEqual(first,second);
  assert.deepEqual(first.map(x=>x.controlId),entries.map(x=>x.id).sort());
  assert.ok(first.every(x=>x.controlDigest===entries.find(entry=>entry.id===x.controlId).content_digest));
  assert.ok(first.every(x=>x.requiresConfirmation===true));
  assert.ok(first.every(x=>['high','review','none'].includes(x.scopeConfidence)));
  assert.ok(first.some(x=>x.level==='suggested'&&x.prepareApplicability===true&&x.matchCount>=2&&x.riskBearingFactCount>=1));
});

test('single broad facts prioritize review but never prepare applicability',()=>{
  for(const fact of ARCHITECTURE_FACTS){
    const result=suggestControls(entries,[fact],'snapshot-fact');
    assert.ok(result.some(x=>x.level==='consider'),`No review candidate for ${fact}`);
    assert.ok(result.every(x=>x.prepareApplicability===false),`Single fact unexpectedly prepared applicability for ${fact}`);
    assert.ok(result.every(x=>x.level!=='suggested'),`Single fact unexpectedly became a strong suggestion for ${fact}`);
  }
  const staging=suggestControls(entries,['environment:staging'],'staging-only');
  assert.ok(staging.filter(x=>x.triggeringFacts.includes('environment:staging')).every(x=>x.scopeConfidence==='review'));
});

test('multi-fact risk-bearing matches can become higher-confidence suggestions but remain non-authoritative',()=>{
  const result=suggestControls(entries,['audience:customer_facing','tool:write','safeguard:human_approval'],'snapshot-multi');
  const prepared=result.filter(x=>x.prepareApplicability);
  assert.ok(prepared.length>0);
  assert.ok(prepared.every(x=>x.level==='suggested'));
  assert.ok(prepared.every(x=>x.limitations.includes('does not prove applicability')));
  assert.ok(prepared.every(x=>x.requiresConfirmation===true));
  const manual=suggestControls(entries,[],'snapshot-empty');
  assert.equal(manual.length,108);
  assert.ok(manual.every(x=>x.level==='manual_review'));
  const baseline=suggestControls(entries,['input:user_messages'],'one'),changed=suggestControls(entries,['tool:network'],'two');
  assert.notDeepEqual(baseline.map(x=>x.triggeringFacts),changed.map(x=>x.triggeringFacts));
});
