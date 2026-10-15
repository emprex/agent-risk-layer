// Fail-closed screening for unsupported security conclusions in untrusted LLM prose.
// This is a lexical safety boundary, not semantic verification or evidence acceptance.
const PROHIBITED=[
  /\b(?:assessment|control|security)\s+(?:objective|requirement|condition)\s+(?:is\s+)?(?:not\s+met|met|failed|passed|satisfied|unsatisfied)\b/i,
  /\b(?:fails?|passes?)\s+(?:the\s+)?(?:assessment|control|security|requirement|test)\b/i,
  /\b(?:non[- ]compliant|compliant|vulnerab(?:le|ility)|exploitable|secure|insecure)\b/i,
  /\b(?:no|missing|absent|lacks?)\s+(?:evidence\s+of\s+)?(?:approval|authori[sz]ation|enforcement|protection|configuration|policy|controls?)\b/i,
  /\b(?:no|none|never)\s+(?:real\s+)?(?:third[- ]party\s+)?(?:service|test|provider|endpoint)\s+(?:was|were|has\s+been)\s+(?:used|exercised|tested|called)\b/i
];
export function screenAdvisoryClaims(answer,facts){
  if(typeof answer!=='string'||!answer.trim()||answer.length>3000)
    return {ok:false,reason:'empty_or_oversized_analysis'};
  const known=new Set(facts.map(f=>f.id));
  const paragraphs=answer.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
  if(!paragraphs.length)return {ok:false,reason:'empty_analysis'};
  for(const paragraph of paragraphs){
    // Require paragraph-level evidence traceability, not one citation for an entire essay.
    const citations=[...paragraph.matchAll(/\[([A-Z][A-Z0-9_]*)\]/g)].map(m=>m[1]);
    if(!citations.length||citations.some(id=>!known.has(id)))
      return {ok:false,reason:'missing_or_unknown_citation'};
    if(PROHIBITED.some(pattern=>pattern.test(paragraph)))
      return {ok:false,reason:'unsupported_security_conclusion'};
  }
  return {ok:true};
}
