export function buildReport(assessment, tier = 'basic') {
  const result = typeof assessment.result_json === 'string' ? JSON.parse(assessment.result_json) : assessment.result_json;
  const created = new Date(assessment.created_at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const immediate = result.recommendations.filter((item) => item.priority === 'Immediate');
  const high = result.recommendations.filter((item) => item.priority === 'High');
  const standard = result.recommendations.filter((item) => item.priority === 'Standard');

  const base = {
    title: `${assessment.name} — AI Agent Security Assessment`,
    assessmentId: assessment.id,
    agentType: assessment.agent_type,
    created,
    generated,
    scoringVersion: assessment.scoring_version || 'arl-risk-v1.0',
    score: result.score,
    riskBand: result.riskBand,
    headline: result.headline,
    methodology: result.methodology,
    responses: result.responses,
    findings: result.findings,
    controls: result.controls,
    recommendations: result.recommendations,
    actionPlan: [
      { window: 'First 24 hours', actions: [...immediate, ...high].slice(0, 3).map((item) => item.text) },
      { window: 'First 7 days', actions: [...high, ...standard].slice(0, 5).map((item) => item.text) },
      { window: 'Within 30 days', actions: result.recommendations.slice(0, 8).map((item) => item.text) },
    ],
    referenceBasis: [
      'OWASP AI Agent Security Cheat Sheet',
      'OWASP Top 10 for Agentic Applications 2026',
      'OWASP Securing Agentic Applications Guide',
      'NIST AI Risk Management Framework 1.0 and Generative AI Profile',
    ],
    limitations: [
      'The result depends on the accuracy and completeness of the answers supplied.',
      'The questionnaire does not inspect source code, infrastructure, prompts, logs or live behaviour.',
      'Equal-weight scoring is a prioritisation aid and is not a substitute for threat modelling or vulnerability testing.',
      'Regulated, safety-critical or high-impact systems require specialist legal, privacy and security review.',
    ],
    disclaimer: 'This automated assessment is decision support, not a penetration test, certification or legal opinion. Validate material findings with qualified security and legal specialists.',
  };

  if (tier !== 'pro') return base;

  return {
    ...base,
    executiveBrief: {
      deploymentDecision: result.score >= 75 ? 'STOP' : result.score >= 50 ? 'CONDITIONAL' : 'PROCEED WITH CONTROLS',
      primaryThreats: result.findings.slice(0, 5).map((item) => item.title),
      controlCoverage: `${result.controls.filter((item) => item.status === 'pass').length}/${result.controls.length} baseline controls passed`,
    },
    verificationChecklist: result.recommendations.slice(0, 10).map((item, index) => ({
      id: `V-${String(index + 1).padStart(2, '0')}`,
      control: item.text,
      evidence: 'Named owner, implementation reference, test result and review date',
    })),
    retestCriteria: [
      'No critical findings remain open.',
      'High-impact actions have enforceable approval and transaction limits.',
      'The agent passes prompt-injection and tool-misuse regression tests.',
      'Kill-switch and credential-revocation procedures have been exercised.',
      'Material changes to models, tools, permissions, data sources or hosting trigger a new assessment.',
    ],
  };
}
