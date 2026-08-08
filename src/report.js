function parseResult(assessment) { return typeof assessment.result_json === 'string' ? JSON.parse(assessment.result_json) : assessment.result_json; }
function date(value) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }); }
function unique(items) { return [...new Set((items || []).filter(Boolean))]; }

export function buildReport(assessment, tier = 'basic', inspection = null, redTeam = null) {
    const result = parseResult(assessment);
    const recommendations = result.recommendations || [];
    const findings = result.findings || [];
    const unresolvedItems = result.unresolvedItems || [];
    const attackPaths = result.attackPaths || [];
    const immediate = recommendations.filter(x => x.priority === 'Immediate');
    const high = recommendations.filter(x => x.priority === 'High');
    const standard = recommendations.filter(x => x.priority === 'Standard');
    const evidenceWeak = (result.responses || []).filter(x => !x.unknown && (x.evidenceScore ?? 35) < 70);
    const verifiedControls = (result.controls || []).filter(x => x.status === 'verified').length;
    const redTeamIsTarget = redTeam?.campaign?.target?.mode === 'staging-adapter';
    let combinedDecision = result.decision || 'REVIEW REQUIRED';
    if ((inspection?.summary?.counts?.critical || 0) > 0 || (redTeamIsTarget && redTeam?.summary?.counts?.critical > 0))
        combinedDecision = 'DO NOT DEPLOY';
    else if ((inspection?.summary?.counts?.high || 0) > 0 || (redTeamIsTarget && redTeam?.summary?.counts?.high > 0))
        combinedDecision = 'DEPLOY ONLY AFTER MATERIAL REMEDIATION';
    else if (redTeamIsTarget && (redTeam?.summary?.counts?.failed || 0) > 0 && !String(combinedDecision).startsWith('DO NOT'))
        combinedDecision = 'REMEDIATE BEFORE RELEASE';
    const combinedHeadline = `${result.headline}${inspection ? ` Static inspection posture ${inspection.summary.postureScore}/100.` : ''}${redTeam ? `${redTeamIsTarget ? ' Controlled red-team' : ' Runner simulation'} assurance ${redTeam.summary.assuranceScore}/100 with ${redTeam.summary.counts.failed} failed cases.` : ''}`;
    const riskSummary = result.scoreAvailable === false ? 'Risk not determined — material information is missing.' : `${result.riskBand} overall declared risk band with an aggregate score of ${result.score}/100${result.highestFindingSeverity ? `; highest declared finding ${result.highestFindingSeverity}.` : '.'}`;
    const base = {
        reportClass: tier === 'pro' ? 'Professional Security Review' : 'Essential Security Review',
        title: `${assessment.name} — AI Agent Security Assessment`, assessmentId: assessment.id, agentType: assessment.agent_type,
        systemDescription: result.systemDescription || '',
        created: date(assessment.created_at), generated: date(new Date()), scoringVersion: assessment.scoring_version || 'arl-risk-v3.0',
        score: result.score, scoreAvailable: result.scoreAvailable !== false, riskBand: result.riskBand, aggregateRiskBand: result.aggregateRiskBand, highestFindingSeverity: result.highestFindingSeverity || '', highestAttackPathSeverity: result.highestAttackPathSeverity || '', headline: combinedHeadline, decision: combinedDecision, methodology: result.methodology,
        metrics: { inherentRisk: result.inherentRisk ?? null, controlGap: result.controlGap ?? null, evidenceConfidence: result.evidenceConfidence ?? 0, assessmentCompleteness: result.assessmentCompleteness ?? 100 },
        responses: result.responses || [], findings, unresolvedItems, attackPaths, controls: result.controls || [], recommendations,
        evidenceSummary: { verifiedControls, totalControls: (result.controls || []).length, weakEvidence: evidenceWeak.length, unresolved: unresolvedItems.length, statement: unresolvedItems.length ? `${unresolvedItems.length} material security questions remain unresolved. They are information gaps, not vulnerabilities, and must be answered before the deployment posture can be determined.` : evidenceWeak.length ? `${evidenceWeak.length} answered items rely on absent or owner-stated evidence and should be independently verified.` : 'The supplied evidence profile is comparatively strong; retain evidence and retest after material change.' },
        actionPlan: [
            ...(unresolvedItems.length ? [{ window: 'First', objective: 'Complete missing architecture and control information', actions: unresolvedItems.slice(0, 8).map(x => x.whatToConfirm) }] : []),
            { window: '0–72 hours', objective: 'Contain confirmed immediate exposure', actions: [...immediate, ...high].slice(0, 4).map(x => x.text) },
            { window: 'Within 14 days', objective: 'Close confirmed material control gaps', actions: [...high, ...standard].slice(0, 7).map(x => x.text) },
            { window: 'Within 30–90 days', objective: 'Institutionalise assurance', actions: standard.slice(0, 8).map(x => x.text) },
        ],
        frameworkMappings: { owasp: result.frameworkSummary?.owasp || unique(findings.flatMap(x => x.frameworks || []).filter(x => x.startsWith('OWASP'))), nist: result.frameworkSummary?.nist || unique([...findings.flatMap(x => x.frameworks || []), ...unresolvedItems.flatMap(x => x.frameworks || [])].filter(x => x.startsWith('NIST'))) },
        referenceBasis: ['OWASP Top 10 for Agentic Applications 2026', 'OWASP AI Agent Security Cheat Sheet', 'OWASP Securing Agentic Applications Guide', 'NIST AI Risk Management Framework 1.0', 'NIST AI 600-1 Generative AI Profile'],
        limitations: [inspection ? 'The local inspector evaluates repository and deployment-configuration evidence within its declared static scope. It does not prove the live environment matches the scanned material.' : 'This is a structured self-assessment. It does not inspect source code, cloud configuration, prompts, models, networks, logs or runtime behaviour.', unresolvedItems.length ? `${unresolvedItems.length} material questions were unanswered; no vulnerability is inferred from those unanswered items.` : null, redTeam ? 'Controlled adversarial evidence covers only selected cases executed by the customer-operated runner against a local, test, simulation, or staging adapter. Raw transcripts are not retained by AgentRiskLayer.' : 'No controlled adversarial run was attached to this report.', 'Evidence levels are declared by the respondent unless separately reviewed.', 'Risk scores prioritise declared control conditions; they are not breach probabilities, certifications or guarantees.', 'Regulated, safety-critical or high-impact systems require specialist legal, privacy, threat-modelling and technical testing.'].filter(Boolean),
        disclaimer: 'AgentRiskLayer provides automated decision support. Local inspection findings and controlled red-team outcomes are customer-operated, integrity-verified evidence with explicit scope limits. They are not an independent penetration test, runtime attestation, certification, audit opinion, insurance product or legal advice.',
        inspection: inspection ? { ...inspection, findings: (inspection.findings || []).slice(0, tier === 'pro' ? 200 : 8) } : null,
        redTeam: redTeam ? { ...redTeam, results: (redTeam.results || []).slice(0, tier === 'pro' ? 100 : 5) } : null
    };
    if (tier !== 'pro') return base;
    return { ...base,
        executiveBrief: { deploymentDecision: base.decision, summary: `${assessment.name}: ${riskSummary} Security information completeness is ${base.metrics.assessmentCompleteness}%, and evidence confidence is ${base.metrics.evidenceConfidence}%.${unresolvedItems.length ? ` ${unresolvedItems.length} unresolved security questions must be completed before this assessment can support a deployment decision.` : ''}${inspection ? ` The latest local inspection observed technical risk ${inspection.summary.technicalRisk}/100 with ${inspection.summary.counts.critical} critical and ${inspection.summary.counts.high} high findings.` : ''}${redTeam ? redTeamIsTarget ? ` Controlled adversarial testing recorded risk ${redTeam.summary.riskScore}/100 with ${redTeam.summary.counts.failed} failed cases, including ${redTeam.summary.counts.critical} critical and ${redTeam.summary.counts.high} high failures.` : ` Runner simulation recorded ${redTeam.summary.counts.failed} failed cases. Simulation validates the testing pipeline only and is not evidence about this assessed system.` : ''}`, primaryThreats: [...attackPaths.slice(0, 5).map(x => x.title), ...(inspection?.findings || []).slice(0, 3).map(x => `Observed: ${x.title}`), ...(redTeam?.results || []).filter(x => x.outcome === 'failed').slice(0, 4).map(x => `Reproduced: ${x.title}`)].slice(0, 9), controlCoverage: `${verifiedControls}/${base.evidenceSummary.totalControls} declared controls are low-risk and evidenced.${unresolvedItems.length ? ` ${unresolvedItems.length} control/context questions remain unresolved.` : ''}${inspection ? ' Static inspection evidence is reported separately and does not automatically prove runtime effectiveness.' : ''}${redTeam ? ' Controlled red-team evidence is reported separately and applies only to the tested adapter, cases, and synthetic data.' : ''}` },
        findingRegister: findings.map((f, index) => ({ ...f, owner: 'Assign accountable control owner', targetDate: index < 3 ? 'Within 72 hours' : index < 8 ? 'Within 14 days' : 'Within 30 days', verification: f.verification || (f.recommendation ? `Demonstrate implementation and execute a negative test proving: ${f.recommendation}` : 'Provide implementation evidence and a repeatable security test.') })),
        verificationChecklist: recommendations.slice(0, 14).map((item, index) => ({ id: `V-${String(index + 1).padStart(2, '0')}`, control: item.text, evidence: 'Named owner; configuration or policy reference; dated test result; reviewer; remediation ticket; next review date', test: 'Attempt the relevant abuse case and confirm the control fails closed with an auditable event.' })),
        retestCriteria: ['No confirmed critical attack path remains open or accepted without accountable executive sign-off.', 'Every applicable high-impact action has deterministic authorisation, transaction-bound approval and hard limits.', 'Prompt-injection, tool-misuse, data-leakage, memory-poisoning, authority-manipulation and runaway-loop tests pass.', 'Kill-switch, credential-revocation and persistent-state containment/recovery procedures are exercised successfully.', 'Material model, prompt, tool, permission, data-source, memory-architecture, learned-behaviour or hosting changes trigger reassessment.'],
        assuranceRoadmap: [
            { phase: 'Design assurance', outcome: 'Threat model, data-flow map, trust boundaries and abuse cases are reviewed.' },
            { phase: 'Build assurance', outcome: 'Policy-as-code, least privilege, schemas, egress restrictions and audit events are implemented.' },
            { phase: 'Release assurance', outcome: 'Adversarial tests and evidence gates block unsafe releases.' },
            { phase: 'Runtime assurance', outcome: 'Behaviour monitoring, spend limits, incident ownership, adaptive-state monitoring and containment are operational.' },
        ]
    };
}
