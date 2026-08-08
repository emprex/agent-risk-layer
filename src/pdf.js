function normalise(value) { return String(value ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, '-').normalize('NFKD').replace(/[^\x20-\x7E]/g, ''); }
function wrap(text, max = 88) {
    const words = normalise(text).split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length <= max)
            line = candidate;
        else {
            if (line)
                lines.push(line);
            line = word;
        }
    }
    if (line)
        lines.push(line);
    return lines.length ? lines : [''];
}
function esc(text) { return normalise(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
export async function renderReportPdf(report) {
    const blocks = [];
    const add = (text, size = 10, bold = false, indent = 0, gap = 4, tone = 'body') => {
        const width = Math.max(20, Math.min(96, Math.floor((490 - indent) / Math.max(4.8, size * .54))));
        for (const line of wrap(text, width))
            blocks.push({ text: line, size, bold, indent, gap, tone });
    };
    const heading = (text, level = 2) => {
        if (level === 1)
            blocks.push({ type: 'section', text, height: 60 });
        else
            add(text, level === 2 ? 15 : 11, true, 0, level === 2 ? 8 : 6, 'heading');
    };
    const pageBreak = () => blocks.push({ pageBreak: true });
    const bullet = (text) => add(`- ${text}`, 9, false, 12, 3);
    const label = (name, value) => { add(name.toUpperCase(), 8, true, 0, 1, 'muted'); add(value, 11, true, 0, 7, 'body'); };
    const cover = () => blocks.push({ type: 'cover', height: 248, title: report.title, reportClass: report.reportClass || 'AI Agent Security Review', decision: report.decision || report.executiveBrief?.deploymentDecision || 'REVIEW REQUIRED', score: report.score, riskBand: report.riskBand });
    const metricRow = (items) => blocks.push({ type: 'metrics', height: 80, items });
    const riskBar = (labelText, value, tone = 'accent') => blocks.push({ type: 'bar', height: 38, label: labelText, value: Math.max(0, Math.min(100, Number(value) || 0)), tone });
    const callout = (title, text, tone = 'accent') => { const lines = wrap(text, 76); blocks.push({ type: 'callout', height: 42 + lines.length * 11, title, lines, tone }); };
    const scoreAvailable = report.scoreAvailable !== false && report.riskBand !== 'Undetermined';
    const unresolved = report.unresolvedItems || [];
    cover();
    if (report.metrics)
        metricRow([
            { label: 'Declared risk', value: scoreAvailable ? `${report.score}/100` : 'Not determined', note: scoreAvailable ? report.riskBand : 'Assessment incomplete' },
            { label: 'Evidence confidence', value: `${report.metrics.evidenceConfidence}/100`, note: 'Evidence profile' },
            { label: 'Assessment completeness', value: `${report.metrics.assessmentCompleteness ?? 100}%`, note: unresolved.length ? `${unresolved.length} unresolved` : 'Questions answered' },
        ]);
    callout('Executive recommendation', report.headline, report.decision === 'DO NOT DEPLOY' ? 'danger' : String(report.decision).includes('MATERIAL') ? 'warning' : String(report.decision).includes('HOLD') ? 'warning' : 'accent');
    add(`Assessment ID: ${report.assessmentId}`, 8, false, 0, 2, 'muted');
    add(`Agent type: ${report.agentType}`, 8, false, 0, 2, 'muted');
    if (report.systemDescription)
        add(`System description: ${report.systemDescription}`, 8, false, 0, 2, 'muted');
    add(`Assessment date: ${report.created}`, 8, false, 0, 2, 'muted');
    add(`Generated: ${report.generated}`, 8, false, 0, 2, 'muted');
    add(`Scoring model: ${report.scoringVersion}`, 8, false, 0, 2, 'muted');
    pageBreak();
    heading('1. Executive security decision', 1);
    if (report.executiveBrief) {
        add(report.executiveBrief.summary, 11, false, 0, 10);
        heading('Primary credible threats', 2);
        if ((report.executiveBrief.primaryThreats || []).length)
            (report.executiveBrief.primaryThreats || []).forEach(bullet);
        else
            add('No credible attack path was established from the answered information.', 9);
        heading('Control assurance', 2);
        add(report.executiveBrief.controlCoverage, 10);
    }
    else
        add(report.headline, 11);
    if (report.evidenceSummary) {
        heading('Evidence confidence', 2);
        add(report.evidenceSummary.statement, 10);
        add(`${report.evidenceSummary.verifiedControls}/${report.evidenceSummary.totalControls} controls are supported as verified low-risk controls.`, 9, true);
    }
    if (report.controlIntelligence) {
        const ci=report.controlIntelligence;
        heading('Control Intelligence evidence', 2);
        add(ci.statement,10,true);
        add(`Project: ${ci.project.name} | Snapshot: ${ci.systemSnapshot.version} | Digest: ${ci.systemSnapshot.digest}`,8,false,0,3,'muted');
        add(`Control profile: ${ci.controlProfileVersion} | Profile digest: ${ci.controlProfileDigest}`,8,false,0,5,'muted');
        add(`Reviewed: ${ci.controlsReviewed||0} | Applicable: ${ci.applicableControls} | Not applicable: ${ci.notApplicableControls||0} | Needs context: ${ci.contextRequiredControls||0} | Observed: ${ci.observedControls} | Missing evidence: ${ci.missingEvidence.length} | Open findings: ${ci.openFindings.length}`,9,true);
        for (const decision of (ci.applicabilityDecisions||[]).slice(0,20)) add(`${decision.controlId}: ${decision.decision.replaceAll('_',' ')} - ${decision.reason}`,8,false,0,2);
        add(`Deployment decision: ${ci.deploymentDecision?.decision||'not recorded'}${ci.stale?' - stale; reassessment required':''}. Runtime evidence: ${ci.runtimeEvidence}. Approval evidence: ${ci.approvalEvidence}.`,9);
        add(ci.disclaimer,8,false,0,4,'muted');
    }
    pageBreak();
    heading('2. Risk composition', 1);
    add('The assessment separates exposure, declared control weakness, unresolved information and evidence confidence. Unknown answers are not scored as vulnerabilities.', 10);
    if (report.metrics) {
        if (scoreAvailable) {
            riskBar('Inherent exposure', report.metrics.inherentRisk, 'warning');
            riskBar('Control weakness', report.metrics.controlGap, 'danger');
        } else {
            callout('Risk not determined', 'Material exposure or control information is missing. Complete the unresolved questions before interpreting a numerical risk score.', 'warning');
        }
        riskBar('Evidence confidence', report.metrics.evidenceConfidence, 'accent');
        riskBar('Assessment completeness', report.metrics.assessmentCompleteness ?? 100, 'accent');
    }
    heading('Decision interpretation', 2);
    add(report.methodology, 9);
    if (report.inspection) {
        pageBreak();
        heading('3. Local technical inspection', 1);
        add('This section contains integrity-verified observations generated by the customer-authorised, read-only AgentRisk Inspector. It does not include source code or secret values and does not prove runtime configuration or independent custody.', 10);
        metricRow([{ label: 'Static posture', value: `${report.inspection.summary.postureScore}/100`, note: `Grade ${report.inspection.summary.grade}` }, { label: 'Technical risk', value: `${report.inspection.summary.technicalRisk}/100`, note: `${report.inspection.summary.findingsTotal || 0} findings` }, { label: 'Evidence class', value: 'SIGNED', note: report.inspection.trust?.evidenceClass || 'Locally observed' }]);
        add(`Scanner ${report.inspection.scannerVersion} | Policy ${report.inspection.policyVersion} | Digest ${report.inspection.digest}`, 8, false, 0, 8, 'muted');
        add(report.inspection.summary.conclusion, 10, false, 0, 10);
        if (report.inspection.delta && report.inspection.delta.status !== 'first-scan') {
            heading('Change since previous inspection', 2);
            add(`Status: ${report.inspection.delta.status} | Technical risk change: ${report.inspection.delta.technicalRiskChange >= 0 ? '+' : ''}${report.inspection.delta.technicalRiskChange} | Posture change: ${report.inspection.delta.postureChange >= 0 ? '+' : ''}${report.inspection.delta.postureChange}`, 9, true);
            add(`New findings: ${(report.inspection.delta.newFindings || []).length} | Resolved findings: ${(report.inspection.delta.resolvedFindings || []).length} | Unchanged: ${report.inspection.delta.unchangedCount || 0}`, 9);
        }
        heading('Observed findings', 2);
        if (!(report.inspection.findings || []).length)
            add('No material static finding was observed within the declared scan scope.', 9);
        for (const f of report.inspection.findings || []) {
            heading(`${f.ruleId} | ${String(f.severity).toUpperCase()} | ${f.title}`, 3);
            add(f.summary, 9, false, 10, 3);
            add(`Confidence: ${f.confidence} | Category: ${f.category}`, 8, false, 10, 3, 'muted');
            if (f.review)
                add(`Risk review: ${f.review.status} | Owner: ${f.review.owner} | Expires: ${f.review.expires || 'not set'} | Reason: ${f.review.reason}`, 8, true, 10, 4, 'muted');
            for (const e of (f.evidence || []).slice(0, 5))
                add(`Evidence: ${e.basename || e.pathHash}${e.line ? ` line ${e.line}` : ''} - ${e.fact}`, 8, false, 14, 2);
            add(`Remediation: ${f.remediation}`, 9, true, 10, 5);
            if (f.frameworks?.length)
                add(`Framework mapping: ${f.frameworks.join(' | ')}`, 8, false, 10, 7, 'muted');
        }
    }
    if (report.redTeam) {
        const isTargetRun = report.redTeam.campaign?.target?.mode === 'staging-adapter';
        pageBreak();
        heading(isTargetRun ? '4. Controlled adversarial testing' : '4. Runner pipeline simulation', 1);
        add(isTargetRun ? 'This section contains redacted, integrity-verified outcomes from the customer-operated AgentRisk Red Team Runner against an explicitly authorised staging adapter. Tests use synthetic canaries and dry-run tools. AgentRiskLayer does not retain raw prompts or target responses.' : 'This section validates the runner, signing, upload, scoring, and reporting pipeline against the built-in simulator. It is not evidence about the assessed customer system and does not change the deployment recommendation.', 10);
        metricRow([{ label: isTargetRun ? 'Red-team assurance' : 'Simulation assurance', value: `${report.redTeam.summary.assuranceScore}/100`, note: `Grade ${report.redTeam.summary.grade}` }, { label: isTargetRun ? 'Adversarial risk' : 'Simulated risk', value: `${report.redTeam.summary.riskScore}/100`, note: `${report.redTeam.summary.counts.failed} failed` }, { label: 'Pass rate', value: `${report.redTeam.summary.passRate ?? 0}%`, note: report.redTeam.summary.confidenceStatement || report.redTeam.summary.decision }]);
        callout(isTargetRun ? 'Controlled test decision' : 'Simulation result', report.redTeam.summary.decision, report.redTeam.summary.counts.critical ? 'danger' : report.redTeam.summary.counts.high ? 'warning' : 'accent');
        add(`Runner ${report.redTeam.runnerVersion} | Policy ${report.redTeam.policyVersion} | Digest ${report.redTeam.digest}`, 8, false, 0, 8, 'muted');
        add(`Cases ${report.redTeam.summary.caseTotal} | Trials ${report.redTeam.summary.trialTotal || report.redTeam.summary.caseTotal} | Pass rate ${report.redTeam.summary.passRate ?? 0}% | Failed ${report.redTeam.summary.counts.failed} | Inconclusive ${report.redTeam.summary.counts.inconclusive} | Errors ${report.redTeam.summary.counts.error}`, 9, true, 0, 8);
        if (isTargetRun && report.redTeam.authorisation) {
            heading('Rules of Engagement', 2);
            add(`Target: ${report.redTeam.authorisation.targetName} | Environment: ${report.redTeam.authorisation.environment} | Authority: ${report.redTeam.authorisation.authorityBasis}`, 9, true, 0, 3);
            add(`Authorised by: ${report.redTeam.authorisation.authorisedBy} (${report.redTeam.authorisation.authorisedRole}) | Window: ${report.redTeam.authorisation.windowStart} to ${report.redTeam.authorisation.windowEnd}`, 8, false, 0, 3, 'muted');
            add(`Permitted: ${(report.redTeam.authorisation.permittedActions || []).join(' | ') || 'Controlled synthetic cases only'}`, 8, false, 0, 3);
            add(`Prohibited: ${(report.redTeam.authorisation.prohibitedActions || []).join(' | ') || 'Production effects and destructive actions'}`, 8, false, 0, 6);
        }
        if (report.redTeam.delta && report.redTeam.delta.status !== 'first-run') {
            heading('Change since previous run', 2);
            add(`Status: ${report.redTeam.delta.status} | Risk change: ${report.redTeam.delta.riskChange >= 0 ? '+' : ''}${report.redTeam.delta.riskChange} | Assurance change: ${report.redTeam.delta.assuranceChange >= 0 ? '+' : ''}${report.redTeam.delta.assuranceChange}`, 9, true);
            add(`Newly failed: ${(report.redTeam.delta.newlyFailed || []).length} | Resolved: ${(report.redTeam.delta.resolved || []).length} | Unchanged: ${report.redTeam.delta.unchanged || 0}`, 9);
        }
        heading('Case outcomes', 2);
        for (const item of report.redTeam.results || []) {
            heading(`${item.caseId} | ${String(item.outcome).toUpperCase()} | ${String(item.severity).toUpperCase()} | ${item.title}`, 3);
            add(`Category: ${item.category} | Confidence: ${item.confidence} | Duration: ${item.durationMs} ms`, 8, false, 10, 3, 'muted');
            for (const evidence of item.evidence || [])
                add(`Evidence: ${evidence.fact}`, 8, false, 14, 2);
            if (item.outcome !== 'passed')
                add(`Remediation: ${item.remediation}`, 9, true, 10, 4);
            if (item.frameworks?.length)
                add(`Framework mapping: ${item.frameworks.join(' | ')}`, 8, false, 10, 6, 'muted');
        }
    }
    if (report.attackPaths?.length) {
        heading('5. Credible attack paths', 1);
        add('Attack paths connect exposure, authority and missing controls into realistic failure scenarios. They are prioritised above isolated checklist items.', 10);
        for (const path of report.attackPaths) {
            heading(`${path.id} | ${String(path.severity).toUpperCase()} | ${path.title}`, 3);
            add(path.narrative, 9, false, 10, 5);
            if (path.frameworks?.length)
                add(`Mapped guidance: ${path.frameworks.join(' | ')}`, 8, false, 10, 7, 'muted');
        }
    }
    if (unresolved.length) {
        heading('Information required before deployment decision', 1);
        add(`${unresolved.length} material assessment question${unresolved.length === 1 ? '' : 's'} remain unresolved. These are information gaps, not discovered vulnerabilities.`, 10, true);
        for (const item of unresolved) {
            heading(`${item.id || 'Information'} | ${item.domain || 'Assessment context'}`, 3);
            add(item.title, 10, true, 10, 2);
            if (item.whyItMatters)
                add(`Why it matters: ${item.whyItMatters}`, 9, false, 10, 3);
            if (item.whatToConfirm)
                add(`What to confirm: ${item.whatToConfirm}`, 9, true, 10, 3);
            if (item.proof)
                add(`Useful evidence: ${item.proof}`, 8, false, 10, 5, 'muted');
        }
    }
    heading('6. Finding register', 1);
    if (!report.findings.length)
        add(unresolved.length ? 'No material control weakness was established from the answered questions. Unresolved information is listed separately and must not be interpreted as a vulnerability.' : 'No material weakness was identified from the supplied answers. Evidence verification is still required.');
    const register = report.findingRegister || report.findings;
    for (const f of register) {
        heading(`${f.id} | ${String(f.severity).toUpperCase()} | ${f.domain || ''}`, 3);
        add(f.title, 10, true, 10, 2);
        add(`Observed condition: ${f.observed}`, 9, false, 10, 3);
        if (f.evidence)
            add(`Evidence status: ${f.evidence}`, 8, false, 10, 3, 'muted');
        if (f.impact)
            add(`Why it matters: ${f.impact}`, 9, false, 10, 3);
        if (f.recommendation)
            add(`Required control: ${f.recommendation}`, 9, true, 10, 3);
        if (f.owner)
            add(`Owner: ${f.owner} | Target: ${f.targetDate}`, 8, false, 10, 3, 'muted');
        if (f.verification)
            add(`Verification: ${f.verification}`, 8, false, 10, 5);
        if (f.frameworks?.length)
            add(`Framework mapping: ${f.frameworks.join(' | ')}`, 8, false, 10, 7, 'muted');
    }
    heading('7. Control assurance matrix', 1);
    for (const c of report.controls || [])
        add(`${String(c.status).toUpperCase()} | ${c.domain || ''} | ${c.name} | Evidence: ${c.evidence || 'Not stated'}`, 9, c.status === 'action', 0, 4);
    heading('8. Prioritised remediation plan', 1);
    if (!(report.recommendations || []).length)
        add(unresolved.length ? 'Complete the missing information before creating remediation items. Remediation should address confirmed control weaknesses, not unanswered questions.' : 'No remediation item was generated from the supplied answers.');
    (report.recommendations || []).forEach((x, i) => {
        add(`${i + 1}. [${x.priority}] ${x.text}`, 9, true, 0, 2);
        if (x.frameworks?.length)
            add(`Guidance: ${x.frameworks.join(' | ')}`, 8, false, 12, 5, 'muted');
    });
    heading('Time-bound roadmap', 2);
    for (const phase of report.actionPlan || []) {
        heading(`${phase.window} - ${phase.objective || ''}`, 3);
        (phase.actions || []).forEach(bullet);
    }
    if (report.assuranceRoadmap) {
        heading('9. Assurance lifecycle', 1);
        for (const phase of report.assuranceRoadmap) {
            heading(phase.phase, 3);
            add(phase.outcome, 9, false, 10, 7);
        }
    }
    if (report.verificationChecklist) {
        heading('10. Verification checklist', 1);
        for (const item of report.verificationChecklist) {
            heading(`${item.id} - ${item.control}`, 3);
            add(`Evidence required: ${item.evidence}`, 8, false, 10, 2);
            add(`Test method: ${item.test}`, 8, false, 10, 6);
        }
    }
    if (report.retestCriteria) {
        heading('Retest acceptance criteria', 2);
        report.retestCriteria.forEach(bullet);
    }
    heading('11. Framework crosswalk', 1);
    heading('OWASP', 2);
    (report.frameworkMappings?.owasp || []).forEach(bullet);
    heading('NIST AI RMF', 2);
    (report.frameworkMappings?.nist || []).forEach(bullet);
    heading('Reference basis', 2);
    (report.referenceBasis || []).forEach(bullet);
    heading('12. Assessment responses and evidence', 1);
    for (const r of report.responses || []) {
        add(`${r.domain || ''} | ${r.title}`, 9, true, 0, 1);
        add(`${r.answer} | Risk points: ${r.unknown || r.notApplicable ? 'not scored' : `${r.points}/10`} | Evidence: ${r.evidenceLabel || 'Not stated'}`, 8, false, 12, 5);
    }
    pageBreak();
    heading('13. Methodology, assumptions and boundaries', 1);
    add(report.methodology, 9);
    heading('Limitations', 2);
    (report.limitations || []).forEach(bullet);
    heading('Important notice', 2);
    add(report.disclaimer, 8);
    const pages = [];
    let page = [], y = 790;
    const heightOf = (block) => block.type ? block.height : (block.size + block.gap);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = blocks[blockIndex];
        if (block.pageBreak) {
            if (page.length)
                pages.push(page);
            page = [];
            y = 790;
            continue;
        }
        const height = heightOf(block);
        const next = blocks[blockIndex + 1];
        const keepWithNext = block.type === 'section' && next && !next.pageBreak ? heightOf(next) : 0;
        if (y - height - keepWithNext < 55) {
            if (page.length)
                pages.push(page);
            page = [];
            y = 790;
        }
        if (block.type)
            page.push({ ...block, yTop: y });
        else
            page.push({ ...block, y });
        y -= height;
    }
    if (page.length)
        pages.push(page);
    const objects = new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']]);
    const kids = [];
    const fill = (hex) => { const h = hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16) / 255} ${parseInt(h.slice(2, 4), 16) / 255} ${parseInt(h.slice(4, 6), 16) / 255} rg`; };
    const stroke = (hex) => { const h = hex.replace('#', ''); return `${parseInt(h.slice(0, 2), 16) / 255} ${parseInt(h.slice(2, 4), 16) / 255} ${parseInt(h.slice(4, 6), 16) / 255} RG`; };
    const palette = { ink: '#0b1217', surface: '#f4f7f5', line: '#d8e2dd', accent: '#0b9f78', danger: '#d64550', warning: '#d68a00', muted: '#65736c', white: '#ffffff' };
    const outlineEntries = [];
    pages.forEach((lines, index) => {
        const contentId = 5 + index * 2, pageId = contentId + 1;
        kids.push(`${pageId} 0 R`);
        for (const line of lines) {
            if (line.type === 'section')
                outlineEntries.push({ title: line.text, pageId });
        }
        const commands = [`${fill(palette.ink)} 0 812 595 30 re f`, `${fill(palette.accent)} 0 808 595 4 re f`];
        for (const line of lines) {
            if (line.type === 'cover') {
                const top = line.yTop, bottom = top - line.height;
                commands.push(`${fill(palette.ink)} 34 ${bottom} 527 ${line.height} re f`);
                commands.push(`${fill(palette.accent)} 34 ${top - 7} 527 7 re f`);
                commands.push(`BT /F2 11 Tf ${fill(palette.accent)} 1 0 0 1 60 ${top - 38} Tm (${esc('AGENTRISKLAYER | ' + line.reportClass.toUpperCase())}) Tj ET`);
                const titleLines = wrap(line.title, 31).slice(0, 4);
                titleLines.forEach((t, i) => commands.push(`BT /F2 22 Tf ${fill(palette.white)} 1 0 0 1 60 ${top - 78 - i * 28} Tm (${esc(t)}) Tj ET`));
                commands.push(`BT /F1 10 Tf 0.72 0.82 0.77 rg 1 0 0 1 60 ${bottom + 48} Tm (${esc('Evidence-led review | Static inspection | Controlled adversarial testing')}) Tj ET`);
                const decisionTone = line.decision === 'DO NOT DEPLOY' ? palette.danger : String(line.decision).includes('MATERIAL') || String(line.decision).includes('HOLD') ? palette.warning : palette.accent;
                commands.push(`${fill(decisionTone)} 392 ${bottom + 30} 145 58 re f`);
                commands.push(`BT /F2 9 Tf ${fill(palette.white)} 1 0 0 1 405 ${bottom + 68} Tm (${esc('DEPLOYMENT DECISION')}) Tj ET`);
                wrap(line.decision, 20).slice(0, 2).forEach((decisionLine, i) => commands.push(`BT /F2 10 Tf ${fill(palette.white)} 1 0 0 1 405 ${bottom + 50 - i * 13} Tm (${esc(decisionLine)}) Tj ET`));
                continue;
            }
            if (line.type === 'section') {
                const y0 = line.yTop - 42;
                commands.push(`${fill(palette.ink)} 40 ${y0} 515 34 re f`);
                commands.push(`${fill(palette.accent)} 40 ${y0} 6 34 re f`);
                commands.push(`BT /F2 17 Tf ${fill(palette.white)} 1 0 0 1 58 ${y0 + 10} Tm (${esc(line.text)}) Tj ET`);
                continue;
            }
            if (line.type === 'metrics') {
                const y0 = line.yTop - line.height + 8, gap = 10, w = (515 - gap * 2) / 3;
                line.items.slice(0, 3).forEach((item, i) => { const x = 40 + i * (w + gap); commands.push(`${fill(palette.surface)} ${x} ${y0} ${w} 62 re f`); commands.push(`${stroke(palette.line)} 0.8 w ${x} ${y0} ${w} 62 re S`); commands.push(`${fill(palette.accent)} ${x} ${y0 + 58} ${w} 4 re f`); commands.push(`BT /F1 8 Tf ${fill(palette.muted)} 1 0 0 1 ${x + 11} ${y0 + 43} Tm (${esc(item.label.toUpperCase())}) Tj ET`); commands.push(`BT /F2 18 Tf ${fill(palette.ink)} 1 0 0 1 ${x + 11} ${y0 + 21} Tm (${esc(item.value)}) Tj ET`); commands.push(`BT /F1 7 Tf ${fill(palette.muted)} 1 0 0 1 ${x + 11} ${y0 + 8} Tm (${esc(String(item.note || '').slice(0, 34))}) Tj ET`); });
                continue;
            }
            if (line.type === 'bar') {
                const y0 = line.yTop - 25, color = line.tone === 'danger' ? palette.danger : line.tone === 'warning' ? palette.warning : palette.accent;
                commands.push(`BT /F2 9 Tf ${fill(palette.ink)} 1 0 0 1 48 ${y0 + 15} Tm (${esc(line.label)}) Tj ET`);
                commands.push(`BT /F2 9 Tf ${fill(palette.ink)} 1 0 0 1 500 ${y0 + 15} Tm (${esc(line.value + '/100')}) Tj ET`);
                commands.push(`${fill(palette.line)} 48 ${y0} 487 8 re f`);
                commands.push(`${fill(color)} 48 ${y0} ${Math.max(3, 487 * line.value / 100)} 8 re f`);
                continue;
            }
            if (line.type === 'callout') {
                const y0 = line.yTop - line.height + 6, color = line.tone === 'danger' ? palette.danger : line.tone === 'warning' ? palette.warning : palette.accent;
                commands.push(`${fill(palette.surface)} 40 ${y0} 515 ${line.height - 10} re f`);
                commands.push(`${fill(color)} 40 ${y0} 6 ${line.height - 10} re f`);
                commands.push(`BT /F2 10 Tf ${fill(color)} 1 0 0 1 58 ${line.yTop - 20} Tm (${esc(line.title.toUpperCase())}) Tj ET`);
                line.lines.forEach((txt, i) => commands.push(`BT /F1 9 Tf ${fill(palette.ink)} 1 0 0 1 58 ${line.yTop - 36 - i * 11} Tm (${esc(txt)}) Tj ET`));
                continue;
            }
            const font = line.bold ? 'F2' : 'F1';
            const rgb = line.tone === 'muted' ? '0.38 0.43 0.42' : line.tone === 'accent' ? '0.05 0.52 0.39' : line.tone === 'heading' ? '0.04 0.08 0.10' : '0.08 0.10 0.12';
            commands.push(`BT /${font} ${line.size} Tf ${rgb} rg 1 0 0 1 ${48 + line.indent} ${line.y} Tm (${esc(line.text)}) Tj ET`);
        }
        commands.push(`${stroke(palette.line)} 0.5 w 48 42 m 547 42 l S`);
        commands.push(`BT /F1 8 Tf ${fill(palette.muted)} 1 0 0 1 48 28 Tm (AgentRiskLayer ${esc(report.scoringVersion)} | Confidential | Page ${index + 1} of ${pages.length}) Tj ET`);
        const stream = commands.join('\n');
        objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
        objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    });
    objects.set(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
    let nextObjectId = Math.max(...objects.keys()) + 1;
    let outlineRootId = null;
    if (outlineEntries.length) {
        outlineRootId = nextObjectId++;
        const itemIds = outlineEntries.map(() => nextObjectId++);
        outlineEntries.forEach((entry, index) => { objects.set(itemIds[index], `<< /Title (${esc(entry.title)}) /Parent ${outlineRootId} 0 R${index ? ` /Prev ${itemIds[index - 1]} 0 R` : ''}${index < itemIds.length - 1 ? ` /Next ${itemIds[index + 1]} 0 R` : ''} /Dest [${entry.pageId} 0 R /FitH 808] >>`); });
        objects.set(outlineRootId, `<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds.at(-1)} 0 R /Count ${itemIds.length} >>`);
    }
    const infoId = nextObjectId++;
    objects.set(infoId, `<< /Title (${esc(report.title)}) /Author (AgentRiskLayer) /Subject (${esc(report.reportClass || 'AI Agent Security Review')}) /Creator (AgentRiskLayer ${esc(report.scoringVersion)}) /Producer (AgentRiskLayer PDF Engine) >>`);
    objects.set(1, `<< /Type /Catalog /Pages 2 0 R${outlineRootId ? ` /Outlines ${outlineRootId} 0 R /PageMode /UseOutlines` : ''} >>`);
    const max = Math.max(...objects.keys());
    let output = '%PDF-1.4\n%ARL2\n';
    const offsets = [0];
    for (let i = 1; i <= max; i++) {
        offsets[i] = Buffer.byteLength(output);
        output += `${i} 0 obj\n${objects.get(i)}\nendobj\n`;
    }
    const xref = Buffer.byteLength(output);
    output += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= max; i++)
        output += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${max + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(output, 'binary');
}
