import test from 'node:test';
import assert from 'node:assert/strict';
import {askLocalOllama} from '../src/agent/ai/ollama-client.mjs';
test('structured request opts into local JSON mode with bounded output',async()=>{
 let sent;
 const result=await askLocalOllama({messages:[{role:'user',content:'Test'}],jsonMode:true,maxOutputTokens:768,timeoutMs:120000,
 fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({message:{content:'{"ok":true}'}})};}});
 assert.equal(result.available,true);
 assert.equal(sent.format,'json');
 assert.equal(sent.options.num_predict,768);
});
test('unstructured caller keeps backwards-compatible Ollama body',async()=>{
 let sent;
 await askLocalOllama({messages:[{role:'user',content:'Test'}],fetchImpl:async(_url,options)=>{
 sent=JSON.parse(options.body);return {ok:true,json:async()=>({message:{content:'Hello'}})};
 }});
 assert.equal(Object.hasOwn(sent,'format'),false);
 assert.equal(Object.hasOwn(sent,'options'),false);
});

test('truncated structured output does not pass into advisory parser',async()=>{
 const result=await askLocalOllama({messages:[],jsonMode:true,maxOutputTokens:1536,
 fetchImpl:async()=>({ok:true,json:async()=>({done_reason:'length',message:{content:'{"schema":'}})})});
 assert.equal(result.available,false);
 assert.equal(result.reason,'ollama_output_truncated');
});
test('structured response retains Ollama completion reason for troubleshooting',async()=>{
 const result=await askLocalOllama({messages:[],jsonMode:true,
 fetchImpl:async()=>({ok:true,json:async()=>({done_reason:'stop',message:{content:'{"schema":"demo"}'}})})});
 assert.equal(result.available,true);
 assert.equal(result.completionReason,'stop');
});
