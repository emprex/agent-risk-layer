const finiteNumber=(value)=>{const number=Number(value);return Number.isFinite(number)?number:null};
const bounded=(value,min,max)=>value!==null&&value>=min&&value<=max;
export function normaliseRedTeamSummary(summary){
  if(!summary||typeof summary!=='object'||Array.isArray(summary))return null;
  const counts=summary.counts;
  if(!counts||typeof counts!=='object'||Array.isArray(counts))return null;
  const assuranceScore=finiteNumber(summary.assuranceScore);
  const riskScore=finiteNumber(summary.riskScore);
  const caseTotal=finiteNumber(summary.caseTotal);
  const trialTotal=finiteNumber(summary.trialTotal??summary.caseTotal);
  const passed=finiteNumber(counts.passed);
  const failed=finiteNumber(counts.failed);
  const inconclusive=finiteNumber(counts.inconclusive??0);
  const error=finiteNumber(counts.error??0);
  const critical=finiteNumber(counts.critical??0);
  const high=finiteNumber(counts.high??0);
  const medium=finiteNumber(counts.medium??0);
  const low=finiteNumber(counts.low??0);
  const grade=typeof summary.grade==='string'?summary.grade.trim():'';
  const decision=typeof summary.decision==='string'?summary.decision.trim():'';
  const required=[caseTotal,trialTotal,passed,failed,inconclusive,error,critical,high,medium,low];
  if(!bounded(assuranceScore,0,100)||!bounded(riskScore,0,100)||required.some(value=>value===null||value<0)||!grade||!decision)return null;
  const submittedPassRate=finiteNumber(summary.passRate);
  const passRate=bounded(submittedPassRate,0,100)?submittedPassRate:(trialTotal?Math.round((passed/trialTotal)*1000)/10:0);
  return {assuranceScore,riskScore,caseTotal,trialTotal,passRate,grade,decision,counts:{passed,failed,inconclusive,error,critical,high,medium,low}};
}
