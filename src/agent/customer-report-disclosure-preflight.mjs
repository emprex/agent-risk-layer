// Read-only advisory preflight. Never authorises external disclosure, a
// security finding, evidence validity, closure, readiness, or deployment.
export const CUSTOMER_DISCLOSURE_PREFLIGHT_SCHEMA =
  'arl.customer-report-disclosure-preflight.v1';

const REPORT_SCHEMA='arl.customer-assessment-report.v1';
const MAX_NODES=20_000;
const MAX_DEPTH=16;
const MAX_TEXT=16_384;
const MAX_FLAGGED_PATHS=200;

const DETECTORS=Object.freeze([
  ['private_key_marker', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ['bearer_token_marker', /\b(?:Authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._~+/-]{12,}/i],
  ['credential_assignment', /\b(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|private[_-]?key)\s*[:=]\s*["']?\S{8,}/i],
  ['contact_email_address', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['url_with_query_string', /https?:\/\/[^\s"'<>]+\?[^\s"'<>]+/i]
]);

function safeMember(name) {
  // Malicious JSON keys may contain secrets. Never echo unknown key text.
  return /^[a-zA-Z][a-zA-Z0-9_]{0,64}$/.test(name) ? '.'+name : '.[other]';
}

export function prepareCustomerReportDisclosurePreflight(report) {
  if (report?.schema !== REPORT_SCHEMA || report?.projection !== 'read_only' ||
      report?.available !== true || report?.securityStateChanged !== false ||
      report?.deploymentDecisionWritten !== false ||
      report?.humanReviewRequired !== true) {
    throw new Error('A verified read-only customer report is required for disclosure preflight.');
  }

  const stats={
    visitedNodes:0,
    scannedTextFields:0,
    truncatedTextFields:0,
    incompleteTraversal:false
  };
  const counts=Object.fromEntries(DETECTORS.map(([name])=>[name,0]));
  const flagged=[];
  let flaggedCandidates=0;
  const stack=[{value:report,path:'report',depth:0}];
  while (stack.length) {
    if (stats.visitedNodes >= MAX_NODES) {
      stats.incompleteTraversal=true;
      break;
    }
    const {value,path,depth}=stack.pop();
    stats.visitedNodes++;

    if (typeof value === 'string') {
      stats.scannedTextFields++;
      const sample=value.length>MAX_TEXT ? value.slice(0,MAX_TEXT) : value;
      if(value.length>MAX_TEXT)stats.truncatedTextFields++;
      const labels=[];
      for(const [label,pattern] of DETECTORS) {
        if(pattern.test(sample)){
          counts[label]++;
          labels.push(label);
        }
      }
      if(labels.length){
        flaggedCandidates++;
        if(flagged.length<MAX_FLAGGED_PATHS)
          flagged.push({field:path,indicators:labels});
      }
    } else if (value && typeof value==='object') {
      if(depth>=MAX_DEPTH){
        stats.incompleteTraversal=true;
        continue;
      }
      if(Array.isArray(value)) {
        for(let i=value.length-1;i>=0;i--)
          stack.push({value:value[i],path:path+'['+i+']',depth:depth+1});
      } else {
        for(const [key,child] of Object.entries(value).reverse())
          stack.push({value:child,path:path+safeMember(key),depth:depth+1});
      }
    }
  }
  return {
    schema:CUSTOMER_DISCLOSURE_PREFLIGHT_SCHEMA,
    status:'HUMAN_DISCLOSURE_REVIEW_REQUIRED',
    automaticDisclosureApproval:false,
    securityFindingAuthority:false,
    deploymentDecisionWritten:false,
    reportContentChanged:false,
    indicatorsAreOnlyHeuristics:true,
    inspectionIncomplete:stats.incompleteTraversal ||
      stats.truncatedTextFields>0 || flaggedCandidates>flagged.length,
    ...stats,
    flaggedFieldCount:flaggedCandidates,
    flaggedFieldsShown:flagged.length,
    indicatorCounts:counts,
    flaggedFields:flagged,
    humanChecklist:[
      'Confirm the recipient and agreed contractual disclosure boundary.',
      'Check every report section and attached evidence for secrets, personal and third-party data.',
      'Resolve any flagged field locally without copying the sensitive value into tickets or chat.',
      'Confirm finding wording, scope exclusions, limitations and accountable decision independently.',
      'Record reviewer identity, explicit disclosure permission and the exact bundle digest outside this diagnostic.'
    ],
    limitations:'No signature, comprehensive PII/secret scan, evidence verification, reviewer attestation or permission to transmit.'
  };
}
