import crypto from 'node:crypto';

export const SUGGESTION_PROFILE_VERSION = 'ARL-SUGGEST-1.0.0';
const MATCHING_METHOD='ordered title, category, problem-statement and applicability metadata rules with manual-review fallback';

export const ARCHITECTURE_FACTS = Object.freeze([
  'audience:customer_facing','audience:internal','input:user_messages','input:email','input:uploaded_files','input:retrieved_documents','input:web_content','input:tool_output','input:memory',
  'data:personal','data:customer_records','data:financial','data:health','data:secrets','data:confidential_internal','tool:read','tool:write','tool:payment','tool:messaging','tool:database','tool:file','tool:network','tool:admin','tool:code_execution','tool:deployment',
  'authority:recommend','authority:prepare','authority:reversible','authority:financial','authority:irreversible','authority:autonomous','safeguard:human_approval','safeguard:external_policy','safeguard:rate_limiting','safeguard:network_allowlist','safeguard:audit_logs','safeguard:runtime_blocking','safeguard:sandboxing','safeguard:data_minimisation','safeguard:recovery',
  'environment:development','environment:staging','environment:production','identity:user','identity:service','identity:shared','identity:tenant_scope','identity:roles'
]);

const RULES = Object.freeze([
  ['audience:customer_facing',/customer|user|public|tenant|identity|prompt/i],['audience:internal',/internal|employee|confidential|privilege/i],
  ['input:user_messages',/prompt|instruction|input|conversation|goal/i],['input:email',/email|message|indirect|content/i],['input:uploaded_files',/file|upload|document|parser/i],['input:retrieved_documents',/retriev|rag|document|knowledge|indirect/i],['input:web_content',/web|url|ssrf|browser|network|indirect/i],['input:tool_output',/tool|output|response|injection/i],['input:memory',/memory|persist|context|poison/i],
  ['data:personal',/personal|privacy|pii|data|disclosure/i],['data:customer_records',/customer|tenant|record|authorization/i],['data:financial',/financial|payment|refund|transaction|value/i],['data:health',/health|sensitive|privacy|data/i],['data:secrets',/secret|credential|token|key|exfiltrat/i],['data:confidential_internal',/confidential|internal|sensitive|disclosure/i],
  ['tool:read',/read|retriev|data|least privilege/i],['tool:write',/write|tool|action|side effect|authorization/i],['tool:payment',/payment|refund|financial|transaction|approval/i],['tool:messaging',/email|message|communication|impersonat/i],['tool:database',/database|sql|record|tenant|query/i],['tool:file',/file|path|upload|storage|traversal/i],['tool:network',/network|ssrf|url|egress|metadata/i],['tool:admin',/admin|privilege|authority|role/i],['tool:code_execution',/code|execution|sandbox|command|model format/i],['tool:deployment',/deploy|release|supply chain|artifact|rollback/i],
  ['authority:recommend',/recommend|decision|human|explain/i],['authority:prepare',/prepare|draft|approval|action/i],['authority:reversible',/reversible|action|rollback|containment/i],['authority:financial',/financial|payment|refund|value|approval/i],['authority:irreversible',/irreversible|destructive|delete|side effect|approval/i],['authority:autonomous',/autonom|agent|authority|runtime|approval/i],
  ['safeguard:human_approval',/approval|human|replay|parameter|target/i],['safeguard:external_policy',/policy|guard|runtime|enforcement/i],['safeguard:rate_limiting',/rate|limit|resource|denial|abuse/i],['safeguard:network_allowlist',/network|allowlist|ssrf|egress/i],['safeguard:audit_logs',/audit|log|evidence|monitor/i],['safeguard:runtime_blocking',/runtime|block|policy|bypass/i],['safeguard:sandboxing',/sandbox|isolation|code|execution/i],['safeguard:data_minimisation',/minimi|privacy|retention|data/i],['safeguard:recovery',/recover|restore|backup|rollback|containment/i],
  ['environment:development',/test|development|safe testing|sandbox/i],['environment:staging',/staging|deploy|release|test/i],['environment:production',/production|runtime|monitor|deploy|incident/i],['identity:user',/user|identity|session|authentication/i],['identity:service',/service|identity|credential|workload/i],['identity:shared',/shared|credential|accountability|identity/i],['identity:tenant_scope',/tenant|workspace|isolation|authorization/i],['identity:roles',/role|permission|least privilege|authorization/i]
].map(([fact,pattern],priority)=>Object.freeze({fact,pattern,priority,rationale:`The assessed architecture includes ${fact.replace(':',' ').replaceAll('_',' ')}.`,limitations:'A metadata match identifies review priority only; it does not prove exposure or control applicability.'})));

const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value&&typeof value==='object' ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
export const SUGGESTION_PROFILE_DIGEST = crypto.createHash('sha256').update(stable({version:SUGGESTION_PROFILE_VERSION,matchingMethod:MATCHING_METHOD,facts:ARCHITECTURE_FACTS,rules:RULES.map(({fact,pattern,priority,rationale,limitations})=>({fact,pattern:pattern.source,flags:pattern.flags,priority,rationale,limitations}))})).digest('hex');

export function suggestControls(entries, architectureFacts, snapshotId) {
  const facts=[...new Set((architectureFacts||[]).filter(f=>ARCHITECTURE_FACTS.includes(f)))].sort();
  return [...entries].sort((a,b)=>a.id.localeCompare(b.id)).map(entry=>{
    const problem=typeof entry.problem_json==='string'?safeJson(entry.problem_json):entry.problem_json||entry.problem||{};
    const text=[entry.id,entry.title,entry.category,problem.statement,...(Array.isArray(problem.applicability)?problem.applicability:[])].filter(Boolean).join(' ');
    const matches=RULES.filter(rule=>facts.includes(rule.fact)&&rule.pattern.test(text)).sort((a,b)=>a.priority-b.priority||a.fact.localeCompare(b.fact));
    const level=matches.length?'suggested':facts.length?'consider':'manual_review';
    const triggeringFacts=matches.map(x=>x.fact);
    const rationale=matches.length?matches.map(x=>x.rationale).join(' '):level==='consider'?'No strong deterministic match was found; review this catalogue control because architecture coverage may be incomplete.':'Review this control manually; no structured architecture facts are confirmed.';
    return {controlId:entry.id,controlTitle:entry.title,level,rationale,triggeringFacts,suggestionProfileVersion:SUGGESTION_PROFILE_VERSION,suggestionProfileDigest:SUGGESTION_PROFILE_DIGEST,controlDigest:entry.content_digest,snapshotId,requiresConfirmation:true,limitations:'Deterministic architecture matching is decision support and does not prove applicability.'};
  });
}

export function suggestionProfile(){return {version:SUGGESTION_PROFILE_VERSION,digest:SUGGESTION_PROFILE_DIGEST,supportedArchitectureFacts:[...ARCHITECTURE_FACTS],ruleCount:RULES.length,matchingMethod:MATCHING_METHOD,limitations:'Suggestions prioritize review and never establish applicability.'};}
function safeJson(value){try{return JSON.parse(value)}catch{return {}}}
