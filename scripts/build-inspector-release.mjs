import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUNDLE_SCHEMA, POLICY_CATALOG, POLICY_VERSION } from '../inspector/agent-risk-inspector.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'inspector', 'agent-risk-inspector.mjs');
const destination = path.join(root, 'public', 'downloads', 'agent-risk-inspector.mjs');
const sourceText = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');

const versionMarker = "export const INSPECTOR_VERSION = '4.1.0';";
const schemaMarker = String.raw`    if(/(?:zod|ajv|jsonschema|pydantic|response_format|json_schema|structuredOutput|schema\.parse|safeParse)/i.test(text))hasSchema=true;`;
const resourceMarker = String.raw`    if(/(?:max_tokens|max_output_tokens|AbortSignal\.timeout|tool_call_limit|max_iterations|(?:retry|recursion|budget|spend)[A-Za-z_]*\s*[:=])/i.test(text))hasLimits=true;`;
const sourceCheckMarker = 'function runSourceChecks(ctx){';

if (!sourceText.includes(versionMarker)) throw new Error('Inspector release build: version marker changed; review the release transform.');
if (!sourceText.includes(schemaMarker)) throw new Error('Inspector release build: structured-output detector marker changed; review the release transform.');
if (!sourceText.includes(resourceMarker)) throw new Error('Inspector release build: resource-limit detector marker changed; review the release transform.');
if (!sourceText.includes(sourceCheckMarker)) throw new Error('Inspector release build: source-check marker changed; review the release transform.');

const manualValidationDetector = String.raw`
function hasStructuredOutputValidation(text){
  // Comments and documentation are not proof. Remove them before both known-framework
  // detection and manual enforcement detection so words such as "structuredOutput"
  // cannot suppress a real finding from documentation alone.
  const executable=text
    .replace(/\/\*[\s\S]*?\*\//g,' ')
    .replace(/^\s*\/\/.*$/gm,' ');
  const knownValidator=/(?:zod|ajv|jsonschema|pydantic|response_format|json_schema|structuredOutput|schema\.parse|safeParse)/i;
  if(knownValidator.test(executable))return true;

  // Manual validation is only treated as evident when several executable enforcement
  // signals occur around an AI/tool boundary. One keyword or one type check is not proof.
  const boundary=/(?:tool_calls|toolCalls|function\.arguments|JSON\.parse\s*\(|response_format|structuredOutput)/i.test(executable);
  const validator=/(?:function\s+(?:validate|assert|check|guard|parse|saniti[sz]e|normali[sz]e)[A-Za-z0-9_$]*\s*\(|(?:const|let|var)\s+(?:validate|assert|check|guard|parse|saniti[sz]e|normali[sz]e)[A-Za-z0-9_$]*\s*=)/i.test(executable);
  const shape=/(?:additionalProperties\s*:\s*false|Object\.keys\s*\(|Array\.isArray\s*\()/i.test(executable);
  const typeCheck=/(?:typeof\s+[^;\n]{1,120}\s*!==?\s*['"](?:string|number|boolean|object)['"]|Number\.isFinite\s*\(|instanceof\s+[A-Za-z_$])/i.test(executable);
  const rejection=/(?:throw\s+new\s+(?:TypeError|Error)\s*\(|Promise\.reject\s*\(|return\s+false\b)/i.test(executable);
  const constraint=/(?:\.length\s*[<>]=?\s*\d+|[<>]=?\s*[A-Z_$][A-Z0-9_$]*|\.test\s*\(|allowedKeys|allowlist|minimum\s*:|maximum\s*:)/i.test(executable);
  return boundary&&validator&&shape&&typeCheck&&rejection&&constraint;
}

function hasAgentResourceLimits(text){
  // Resource-control claims in comments are not evidence. Only executable/configuration
  // signals in the same source file as the AI integration can satisfy this detector.
  const executable=text
    .replace(/\/\*[\s\S]*?\*\//g,' ')
    .replace(/^\s*\/\/.*$/gm,' ');

  const signals=[
    /(?:\btimeout\s*:\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|AbortSignal\.timeout\s*\()/i,
    /(?:\bmaxRetries\s*:\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bmax_retries\s*[:=]\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bretry[A-Za-z_]*\s*[:=]\s*\d[\d_]*)/i,
    /(?:\bmax_completion_tokens\s*:\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bmax_tokens\s*:\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bmax_output_tokens\s*:\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b)/i,
    /(?:\btool_call_limit\s*[:=]\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bmaxToolCalls\s*[:=]\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\btoolCalls\.length\s*(?:>|>=)\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b)/i,
    /(?:\bmax_iterations\s*[:=]\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\bmaxIterations\s*[:=]\s*(?:\d[\d_]*|[A-Z_$][A-Z0-9_$]*)\b|\brecursion[A-Za-z_]*\s*[:=]\s*\d[\d_]*)/i,
    /(?:\b(?:budget|spend|concurrency)[A-Za-z_]*\s*[:=]\s*(?:\d[\d_.]*|[A-Z_$][A-Z0-9_$]*)\b)/i,
  ];

  // Require more than a single incidental setting. This keeps ARL-AI-005 conservative
  // while recognising a real bounded execution policy such as timeout + retry/token/tool caps.
  return signals.reduce((count,pattern)=>count+(pattern.test(executable)?1:0),0)>=2;
}
`;

const text = sourceText
  .replace(versionMarker, "export const INSPECTOR_VERSION = '4.1.2';")
  .replace(sourceCheckMarker, `${manualValidationDetector}\n${sourceCheckMarker}`)
  .replace(resourceMarker, '    if(aiInFile&&hasAgentResourceLimits(text))hasLimits=true;')
  .replace(schemaMarker, '    if(hasStructuredOutputValidation(text))hasSchema=true;');

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, text);
const digest = crypto.createHash('sha256').update(text).digest('hex');
fs.writeFileSync(`${destination}.sha256`, `${digest}  agent-risk-inspector.mjs\n`);
fs.writeFileSync(path.join(root, 'public', 'inspector-policy.json'), JSON.stringify({ policyVersion: POLICY_VERSION, rules: POLICY_CATALOG }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'public', 'downloads', 'inspector-release.json'), JSON.stringify({
  name: 'AgentRisk Inspector', version: '4.1.2', policyVersion: POLICY_VERSION,
  bundleSchema: BUNDLE_SCHEMA, sha256: digest,
  privacyContract: ['No source code uploaded','No matched secret values uploaded','Read-only static inspection','No exploitation or network probing'],
}, null, 2) + '\n');
console.log(JSON.stringify({ version: '4.1.2', policyVersion: POLICY_VERSION, sha256: digest }, null, 2));
