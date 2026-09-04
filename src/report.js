function parseResult(assessment) { return typeof assessment.result_json === 'string' ? JSON.parse(assessment.result_json) : assessment.result_json; }
function date(value) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }); }
function unique(items) { return [...new Set((items || []).filter(Boolean))]; }
function deploymentDecisionLabel(value = '') {
    if (value === 'proceed') return 'PROCEED';
    if (value === 'hold') return 'HOLD';
    if (value === 'do_not_deploy') return 'DO NOT DEPLOY';
    return 'REVIEW REQUIRED';
}
function planLabel(id = '') {
    return ({
        'mcp-authority': 'Tool and MCP authority enforcement',
        'approval-binding': 'Exact-action approval binding',
        'memory-isolation': 'Memory and tenant isolation',
        'egress-boundary': 'Outbound network boundary',
        'audit-reconstruction': 'Audit reconstruction',
        'containment-recovery': 'Containment and recovery',
    })[id] || id || 'Evidence question';
}
function runtimeFinding(item, index) {
    return {
        id: item.caseId || `RT-${String(index + 1).padStart(2, '0')}`,
        severity: item.severity || 'medium',
        domain: item.category || 'Controlled adversarial testing',
        title: item.title || 'Bounded runtime failure',
        observed: (item.evidence || []).map(x => x.fact).filter(Boolean).join(' ') || 'The authorised bounded case reproduced a failure.',
        evidence: 'Authorised target-specific bounded runtime failure',
        impact: item.impact || 'The tested security invariant did not hold for the authorised bounded case.',
        recommendation: item.remediation || 'Implement the required control and rerun the exact bounded case.',
        verification: `Rerun ${item.caseId || 'the exact bounded case'} after implementation and retain the result lineage.`,
        frameworks: item.frameworks || [],
    };
}

export function buildReport(assessment, tier = 'basic', inspection = null, redTeam = null) {
    const result = parseResult(assessment) || {};
    const declaredConcerns = result.findings || [];
    const unresolvedItems = result.unresolvedItems || [];
    const attackPaths = result.attackPaths || [];
    const evidenceWeak = (result.responses || []).filter(x => !x.unknown && (x.evidenceScore ?? 35) < 70);
    const verifiedControls = (result.controls || []).filter(x => x.status === 'verified').length;
    const redTeamIsTarget = redTeam?.campaign?.target?.mode === 'staging-adapter';
    const targetFailures = redTeamIsTarget ? (redTeam?.results || []).filter(x => x.outcome === 'failed').map(runtimeFinding) : [];
    const explicitConfirmed = Array.isArray(result.confirmedFindings) ? result.confirmedFindings : [];
    const findings = [...explicitConfirmed, ...targetFailures];
    const deploymentDecision = result.deploymentDecision || null;
    const decision = deploymentDecisionLabel(deploymentDecision?.decision);
    const blockers = deploymentDecision?.blockersAtDecision || {};
    const evidencePlanResolutions = result.evidencePlanResolutions && typeof result.evidencePlanResolutions === 'object' && !Array.isArray(result.evidencePlanResolutions)
        ? result.evidencePlanResolutions : {};
    const evidenceGaps = Object.entries(evidencePlanResolutions).filter(([, value]) => value?.state === 'evidence-gap');
    const notApplicable = Object.entries(evidencePlanResolutions).filter(([, value]) => value?.state === 'not-applicable');
    const recordedEvidenceGapCount = Number(blockers.recordedEvidenceGaps ?? evidenceGaps.length) || 0;
    const unresolvedEvidenceQuestionCount = Number(blockers.unresolvedEvidenceQuestions ?? (result.blockingEvidenceGaps || []).length) || 0;
    const informationGapCount = Number(blockers.informationGaps ?? unresolvedItems.length) || 0;
    const confirmedRuntimeFailureCount = Number(blockers.confirmedRuntimeFailures ?? targetFailures.length) || 0;
    const totalEvidenceLimitations = recordedEvidenceGapCount + unresolvedEvidenceQuestionCount;
    const humanDecisionText = deploymentDecision
        ? `Human deployment decision: ${decision}. ${deploymentDecision.rationale}`
        : 'No accountable human deployment decision has been recorded for this assessment.';
    const evidenceStateText = `${informationGapCount} information gap${informationGapCount === 1 ? '' : 's'}${totalEvidenceLimitations ? ` and ${totalEvidenceLimitations} evidence limitation${totalEvidenceLimitations === 1 ? '' : 's'}` : ''}${confirmedRuntimeFailureCount ? `, with ${confirmedRuntimeFailureCount} confirmed bounded-test failure${confirmedRuntimeFailureCount === 1 ? '' : 's'}` : ''}.`;
    const combinedHeadline = `${humanDecisionText} ${evidenceStateText} ${findings.length ? `${findings.length} confirmed finding${findings.length === 1 ? '' : 's'} require remediation and exact retest.` : 'No confirmed finding is currently eligible for remediation.'}`;
    const riskSummary = result.scoreAvailable === false
        ? 'Questionnaire risk is not determined because material information is missing.'
        : `${result.riskBand} questionnaire-only provisional band with an aggregate score of ${result.score}/100.`;
    const controls = (result.controls || []).map(control => control.status === 'action'
        ? { ...control, status: 'declared-concern', evidence: control.evidence || 'Declared condition - verification required' }
        : control);
    const confirmedRecommendations = findings.map(f => ({
        priority: ['critical', 'high'].includes(String(f.severity).toLowerCase()) ? 'High' : 'Standard',
        text: f.recommendation || `Remediate ${f.title}`,
        frameworks: f.frameworks || [],
    }));
    const evidenceActions = evidenceGaps.map(([id, resolution]) => `Close evidence gap: ${planLabel(id)}. ${resolution.rationale || ''}`.trim());
    const actionPlan = [
        ...(unresolvedItems.length ? [{ window: 'First', objective: 'Complete missing architecture and control information', actions: unresolvedItems.slice(0, 8).map(x => x.whatToConfirm).filter(Boolean) }] : []),
        ...(evidenceActions.length ? [{ window: 'Next', objective: 'Close recorded evidence gaps with bounded proof', actions: evidenceActions.slice(0, 8) }] : []),
        ...(findings.length ? [{ window: 'Then', objective: 'Fix confirmed findings and exact-retest them', actions: confirmedRecommendations.slice(0, 8).map(x => x.text) }] : []),
    ];
    const inspectionForReport = inspection ? {
        ...inspection,
        summary: {
            ...inspection.summary,
            conclusion: `${inspection.summary?.findingsTotal || inspection.findings?.length || 0} source observations were recorded by the read-only static inspection. Scanner severity is triage severity only: these observations are not confirmed assessment findings and do not establish runtime behaviour.`,
        },
        findings: (inspection.findings || []).slice(0, tier === 'pro' ? 20 : 8).map(item => ({
            ...item,
            summary: `Static source observation only. ${item.summary || ''}`.trim(),
            remediation: item.remediation ? `Possible fix if review confirms a real control failure: ${item.remediation}` : 'Review the source observation before assigning remediation.',
        })),
    } : null;
    const base = {
        reportClass: tier === 'pro' ? 'Professional Security Review' : 'Essential Security Review',
        title: `${assessment.name} - AI Agent Security Assessment`, assessmentId: assessment.id, agentType: assessment.agent_type,
        systemDescription: result.systemDescription || '',
        created: date(assessment.created_at), generated: date(new Date()), scoringVersion: assessment.scoring_version || 'arl-risk-v3.0',
        score: result.score, scoreAvailable: result.scoreAvailable !== false, riskBand: result.riskBand, aggregateRiskBand: result.aggregateRiskBand,
        highestFindingSeverity: findings.length ? findings.map(x => String(x.severity || '').toLowerCase()).sort((a, b) => ({ critical: 4, high: 3, medium: 2, low: 1 }[b] || 0) - ({ critical: 4, high: 3, medium: 2, low: 1 }[a] || 0))[0] : '',
        highestAttackPathSeverity: '', headline: combinedHeadline, decision, methodology: result.methodology,
        deploymentDecision: deploymentDecision ? { ...deploymentDecision, label: decision } : null,
        evidenceLimitations: { informationGaps: informationGapCount, recordedEvidenceGaps: recordedEvidenceGapCount, unresolvedEvidenceQuestions: unresolvedEvidenceQuestionCount, confirmedRuntimeFailures: confirmedRuntimeFailureCount, totalEvidenceLimitations },
        evidencePlanResolutions,
        metrics: { inherentRisk: result.inherentRisk ?? null, controlGap: result.controlGap ?? null, evidenceConfidence: result.evidenceConfidence ?? 0, assessmentCompleteness: result.assessmentCompleteness ?? 100 },
        responses: result.responses || [], findings, declaredConcerns, unresolvedItems, attackPaths: [], controls, recommendations: confirmedRecommendations,
        evidenceSummary: {
            verifiedControls, totalControls: controls.length, weakEvidence: evidenceWeak.length, unresolved: unresolvedItems.length,
            statement: `${evidenceStateText} Unknown or inconclusive information is not a vulnerability. Source observations remain separate from confirmed findings.${notApplicable.length ? ` ${notApplicable.length} bounded evidence question${notApplicable.length === 1 ? ' was' : 's were'} recorded as not applicable.` : ''}`,
        },
        actionPlan,
        frameworkMappings: {
            owasp: unique(findings.flatMap(x => x.frameworks || []).filter(x => x.startsWith('OWASP'))),
            nist: unique([...findings.flatMap(x => x.frameworks || []), ...unresolvedItems.flatMap(x => x.frameworks || [])].filter(x => x.startsWith('NIST'))),
        },
        referenceBasis: ['OWASP Top 10 for Agentic Applications 2026', 'OWASP AI Agent Security Cheat Sheet', 'OWASP Securing Agentic Applications Guide', 'NIST AI Risk Management Framework 1.0', 'NIST AI 600-1 Generative AI Profile'],
        limitations: [
            inspection ? 'The local inspector evaluates repository and deployment-configuration evidence within its declared static scope. Scanner observations and scanner severity are triage signals, not confirmed findings or runtime proof.' : 'This is a structured self-assessment. It does not inspect source code, cloud configuration, prompts, models, networks, logs or runtime behaviour.',
            unresolvedItems.length ? `${unresolvedItems.length} material questions were unanswered; no vulnerability is inferred from those unanswered items.` : null,
            totalEvidenceLimitations ? `${totalEvidenceLimitations} evidence limitations remained at deployment review; they limit assurance but are not findings.` : null,
            redTeam ? redTeamIsTarget ? 'Controlled adversarial evidence covers only the authorised target, bounded cases and synthetic data used in that run.' : 'The attached runner simulation validates the testing pipeline only. It is not evidence about the assessed target.' : 'No controlled adversarial run was attached to this report.',
            'Evidence levels are declared by the respondent unless separately reviewed.',
            'Risk scores prioritise declared control conditions; they are not breach probabilities, certifications or guarantees.',
            'Regulated, safety-critical or high-impact systems require specialist legal, privacy, threat-modelling and technical testing.',
        ].filter(Boolean),
        disclaimer: 'AgentRiskLayer provides evidence and automated decision support. A declaration is not proof, a source observation is not automatically a confirmed finding, a fix is not verified until bounded retest supports it, and runtime completion is not a deployment decision. The accountable human decision is recorded separately. AgentRiskLayer is not an independent penetration test, runtime attestation, certification, audit opinion, insurance product or legal advice.',
        inspection: inspectionForReport,
        redTeam: redTeam ? { ...redTeam, results: (redTeam.results || []).slice(0, tier === 'pro' ? 100 : 5) } : null,
    };
    if (tier !== 'pro') return base;
    const confirmedThreats = findings.slice(0, 9).map(x => `Confirmed: ${x.title}`);
    return {
        ...base,
        executiveBrief: {
            deploymentDecision: base.decision,
            summary: `${assessment.name}: ${riskSummary} ${humanDecisionText} ${evidenceStateText} ${findings.length ? `${findings.length} confirmed finding${findings.length === 1 ? '' : 's'} remain open.` : 'No confirmed finding is open.'}${inspection ? ` The latest static inspection recorded ${inspection.summary?.findingsTotal || inspection.findings?.length || 0} source observations; those scanner signals are reported separately and are not promoted into findings.` : ''}${redTeam ? redTeamIsTarget ? ` Authorised bounded testing recorded ${redTeam.summary.counts.failed} failed cases.` : ' A runner simulation is attached for pipeline validation only and is not target evidence.' : ''}`,
            primaryThreats: confirmedThreats,
            controlCoverage: `${verifiedControls}/${base.evidenceSummary.totalControls} declared controls are supported as verified low-risk controls. ${evidenceStateText} Source observations, declared concerns and evidence gaps remain separate from confirmed findings.`,
        },
        findingRegister: findings.map((f, index) => ({
            ...f,
            owner: f.owner || 'Assign accountable control owner',
            targetDate: f.targetDate || (index < 3 ? 'Within 72 hours' : index < 8 ? 'Within 14 days' : 'Within 30 days'),
            verification: f.verification || (f.recommendation ? `Demonstrate implementation and rerun the exact bounded case supporting: ${f.recommendation}` : 'Provide implementation evidence and a repeatable bounded security test.'),
        })),
        verificationChecklist: findings.slice(0, 14).map((item, index) => ({
            id: `V-${String(index + 1).padStart(2, '0')}`,
            control: item.recommendation || item.title,
            evidence: 'Named owner; implementation evidence; dated bounded retest; reviewer; remediation record; next review date',
            test: item.verification || 'Rerun the exact bounded case and confirm the security invariant holds with auditable evidence.',
        })),
        retestCriteria: findings.length ? [
            'Every confirmed finding has implementation evidence linked to the assessed revision or successor revision.',
            'Each affected invariant is retested with the same bounded case or an explicitly equivalent approved case.',
            'No finding is marked verified solely from a declaration, source observation or generic pipeline simulation.',
        ] : null,
        assuranceRoadmap: [
            { phase: 'Design assurance', outcome: 'Threat model, data-flow map, trust boundaries and material evidence questions are reviewed.' },
            { phase: 'Build assurance', outcome: 'Applicable controls are implemented with evidence linked to the assessed scope.' },
            { phase: 'Release assurance', outcome: 'Confirmed findings are fixed and exact bounded retests support closure before deployment review.' },
            { phase: 'Runtime assurance', outcome: 'Material changes trigger targeted reassessment so evidence remains current.' },
        ],
    };
}
