import {screenAdvisoryClaims} from './advisory-claim-guard.mjs';

const allowedTypes=new Set(['observation','hypothesis','verification','limitation']);
const hash=/^[a-f0-9]{64}$/;
export function validateStructuredAdvisory(raw,facts){
 let data;try{data=JSON.parse(String(raw).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,''));}catch{return {ok:false,reason:'invalid_json'};}
 if(!data||(data.schema!==undefined&&data.schema!=='arl.ai.evidence-brief.v1')||!Array.isArray(data.items)||
   data.items.length<1||data.items.length>12)return {ok:false,reason:'invalid_structure'};
 const byId=new Map(facts.map(f=>[f.id,f]));
 const items=[];
 for(const item of data.items){
   if(!item||!allowedTypes.has(item.type)||typeof item.text!=='string'||
      !item.text.trim()||item.text.length>350||!Array.isArray(item.factIds)||
      item.factIds.length<1||item.factIds.length>8||
      item.factIds.some(id=>!byId.has(id))||
      (item.artifactSha256!==undefined&&(!Array.isArray(item.artifactSha256)||item.artifactSha256.some(x=>!hash.test(x)))))
      return {ok:false,reason:'invalid_item_or_lineage'};
   const selected=item.factIds.map(id=>byId.get(id));
   if(item.type==='observation'&&!item.factIds.some(id=>/^O\d+_\d+$/.test(id)))
     return {ok:false,reason:'observation_requires_source_fact'};
   if(item.type==='verification'&&!item.factIds.some(id=>/^R\d+$/.test(id)))
     return {ok:false,reason:'verification_requires_requirement'};
   const provenance=[...new Set(selected.flatMap(f=>f.artifactSha256?[f.artifactSha256]:[]))];
   if(item.type==='observation'&&provenance.length===0)
     return {ok:false,reason:'observation_requires_digest'};
   if((item.artifactSha256||[]).some(d=>!provenance.includes(d)))
     return {ok:false,reason:'unbound_artifact_digest'};
   const screened=screenAdvisoryClaims(item.text+' ['+item.factIds.join('] [')+']',facts);
   if(!screened.ok)return {ok:false,reason:screened.reason};
   items.push({type:item.type,text:item.text.trim(),factIds:[...new Set(item.factIds)],artifactSha256:provenance});
 }
 return {ok:true,items};
}
export function renderStructuredAdvisory(items){
 return items.map(i=>i.type.toUpperCase()+': '+i.text+' '+i.factIds.map(id=>'['+id+']').join(' ')).join('\n\n');
}
