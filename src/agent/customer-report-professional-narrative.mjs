// Evidence-constrained customer narrative. This is a read-only projection,
// not an assessor, decision engine or certification function.
// Aligns with ARL-AASC Assessment Report & Decision Package Specification v0.1
// (controlled scheme-design draft, not approved normative certification scheme).
const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return fallback;
  // Markdown/HTML-safe human text, bounded and single-line. The independent
  // disclosure preflight must still be run before sharing with a customer.
  return String(value).slice(0, 2048)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
};

const label = value => text(value, 'UNKNOWN');
const count = value => Number.isInteger(value) && value >= 0 ? String(value) : 'Not recorded';
const list = value => Array.isArray(value) ? value : [];
const ids = value => list(value).filter(id =>
  typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{2,127}$/.test(id));
const looksRecorded = value => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
};
const detail = value => {
  if (Array.isArray(value)) {
    return value.length ? value.filter(x=>typeof x==='string')
      .map(x=>text(x)).join('; ') || 'See authoritative scope record' : 'None recorded';
  }
  return text(value);
};

export const CUSTOMER_REPORT_QUALITY_SCHEMA = 'arl.customer-assessment-quality-review.v1';

// Describes which customer-review essentials are present in the projection.
// It NEVER confers security or delivery approval.
export function describeCustomerReportQuality(report) {
  if (report?.schema !== 'arl.customer-assessment-report.v1' ||
    report?.available !== true || report?.projection !== 'read_only' ||
    report?.securityStateChanged !== false ||
    report?.deploymentDecisionWritten !== false ||
    report?.humanReviewRequired !== true ||
    !Array.isArray(report.controls)) {
    throw new Error('Authoritative read-only customer report required for quality review.');
  }
  const controls = report.controls;
  const controlIds = controls.map(x=>x?.controlId);
  const mappedCount = report.assessment?.mappedControlCount;
  const traceableControls = Number.isInteger(mappedCount) && mappedCount > 0 &&
    controls.length === mappedCount && controlIds.every(id =>
      typeof id === 'string' && /^ARL-KB-\d{3}$/.test(id)) &&
    new Set(controlIds).size === controls.length;
  const findings = controls.flatMap(c=>list(c?.findings));
  const tests = controls.flatMap(c=>[...list(c?.tests),...list(c?.retests)]);
  const evidenceItems = controls.reduce((n,c)=>
    n+(Number.isInteger(c?.evidence?.verifiedActiveItems)
      ? c.evidence.verifiedActiveItems : 0),0);
  const verifiedEvidenceIds = controls.reduce((n,c)=>n+
    ids(c?.evidence?.verifiedActiveIds).length,0);
  const findingIds = findings.filter(f=>typeof f?.findingId==='string' &&
    /^[A-Za-z][A-Za-z0-9_-]{2,127}$/.test(f.findingId)).length;
  const testIds = tests.filter(t=>typeof t?.testExecutionId==='string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(t.testExecutionId)).length;
  const limitations = list(report.limitations);
  const gaps = [];
  if (!looksRecorded(report.assessment?.projectName) ||
      !looksRecorded(report.assessment?.targetRevision) ||
      !looksRecorded(report.assessment?.systemSnapshotVersion)) {
    gaps.push('An identifiable assessed object, version, or snapshot is absent.');
  }
  if (!looksRecorded(report.assessment?.scopeStatement))
    gaps.push('The agreed scope statement is not included.');
  if (!looksRecorded(report.assessment?.scopeExclusions))
    gaps.push('Scope exclusions are not explicitly documented in this report.');
  if (!traceableControls)
    gaps.push('The reported control population is empty, incomplete or mismatched.');
  if (evidenceItems > verifiedEvidenceIds)
    gaps.push('Some verified evidence is counted but its safe reference ID is not present.');
  if (findingIds !== findings.length)
    gaps.push('Some recorded findings lack safe traceability identifiers in the customer report.');
  if (testIds !== tests.length)
    gaps.push('Some test/retest records lack safe execution identifiers in the customer report.');
  // Reviewer identity is not present in the current canonical projection.
  gaps.push('Independent reviewer identity, conflicts and sign-off are not represented in this report.');
  // The projection does not claim customer consent / signed ROE as verified.
  gaps.push('Owner authorisation / exact Rules of Engagement are not independently attested in this report.');
  if (limitations.length === 0)
    gaps.push('No explicit material limitations list is recorded; verify completeness with the assessor.');
  return {
    schema: CUSTOMER_REPORT_QUALITY_SCHEMA,
    qualityState: 'requires_accountable_human_review',
    factualControlsMapped: traceableControls ? controls.length : 0,
    verifiedActiveEvidenceItems: evidenceItems,
    evidenceReferenceIds: verifiedEvidenceIds,
    testExecutionRecords: tests.length,
    testExecutionIds: testIds,
    findingsRecorded: findings.length,
    findingIds,
    recordedMissingEvidenceItems: list(report.summary?.missingEvidence).length,
    explicitlyRecordedLimitations: limitations.length,
    reportCompletenessGaps: gaps,
    customerReleaseApproved: false,
    certificationIssued: false,
    securityVerdictInferred: false,
    humanReviewRequired: true
  };
}

export function renderProfessionalCustomerReport(report) {
  const quality = describeCustomerReportQuality(report);
  const summary = report.summary || {};
  const assessment = report.assessment || {};
  const readiness = report.readiness || {};
  const controls = report.controls;

  const lines = [
    '# AGENTRISKLAYER — AI Agent Security Assessment',
    '',
    '**Status: TECHNICAL REPORT FOR ACCOUNTABLE HUMAN REVIEW — NOT A CERTIFICATE**',
    '',
    '## 1. Assessment identity and scope',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Assessed organisation / project | '+text(assessment.projectName)+' |',
    '| Target Git revision | '+text(assessment.targetRevision)+' |',
    '| System snapshot | '+text(assessment.systemSnapshotVersion)+' |',
    '| Control catalogue | '+text(assessment.controlProfileVersion)+' |',
    '| Workflow stage | '+text(assessment.workflowStage)+' |',
    '| Evidence plan state | '+text(assessment.evidencePlanState)+' |',
    '| Mapped control records | '+count(assessment.mappedControlCount)+' |',
    '| Report reviewer / sign-off | Not represented in this projection |',
    '',
    '**Scope included:** '+detail(assessment.scopeStatement),
    '',
    '**Exclusions:** '+detail(assessment.scopeExclusions),
    '',
    'Methodology boundary: evidence-led, human-decided, version-bound technical assessment. An individual test PASS is not a satisfied requirement, and missing evidence is not a vulnerability finding by itself.',
    '',
    '## 2. Executive summary — supported by recorded evidence only',
    '',
    '| Measure | Record |',
    '|---|---:|',
    '| Control records returned | '+count(controls.length)+' |',
    '| Controls reviewed (authoritative summary) | '+count(summary.controlsReviewed)+' |',
    '| Applicable controls (authoritative summary) | '+count(summary.applicableControls)+' |',
    '| Controls with observations (authoritative summary) | '+count(summary.observedControls)+' |',
    '| Verified, active evidence items in projected controls | '+count(quality.verifiedActiveEvidenceItems)+' |',
    '| Test / retest records in projected controls | '+count(quality.testExecutionRecords)+' |',
    '| Recorded findings in projected controls | '+count(quality.findingsRecorded)+' |',
    '| Missing-evidence entries in authoritative summary | '+count(quality.recordedMissingEvidenceItems)+' |',
    '',
    '**Readiness state:** '+label(readiness.status)+'. '+text(readiness.rationale,'No recorded readiness rationale.'),
    '',
    '**Human deployment decision recorded:** '+(readiness.finalDecisionRecorded===true?'YES':'NO')+
      '. This report export does not write or approve one.',
    '',
    '**Material coverage interpretation:** Counts describe the records currently available; they are not percentages of the attack surface, proof of absence of vulnerabilities, or accreditation.',
    '',
    '## 3. Findings — separate from missing evidence',
    ''
  ];
  if (!quality.findingsRecorded) {
    lines.push('No confirmed finding detail appears in the returned control records. **This does not mean the agent passed testing or has no vulnerabilities.**');
  } else {
    lines.push('| Finding ID | Control | Title | Severity | Human severity state | Remediation status |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of controls) {
      for (const f of list(c.findings)) {
        lines.push('| '+text(f.findingId,'Not recorded')+
          ' | '+text(c.controlId)+' | '+text(f.title)+
          ' | '+text(f.contextualSeverity,'Not assigned')+
          ' | '+text(f.severityStatus,'Not evaluated')+
          ' | '+text(f.status,'UNKNOWN')+' |');
      }
    }
  }
  lines.push('', '## 4. Per-control evidence, test and retest traceability', '');
  for (const c of controls) {
    lines.push('### '+text(c.controlId)+' — '+text(c.title,'Unnamed ARL control'));
    lines.push('Applicability: '+label(c.applicability?.status)+
      ' · Authority stage: '+label(c.authorityState?.currentStage)+
      ' · Evidence held: '+count(c.evidence?.currentItems)+
      ' · Verified and active: '+count(c.evidence?.verifiedActiveItems)+
      ' · Verified IDs: '+(ids(c.evidence?.verifiedActiveIds).map(x=>text(x)).join(', ')||'None in projection')+'.');
    for(const [name,records] of [
      ['Tests',c.tests], ['Exact retests',c.retests]
    ]) {
      const recordsList = list(records);
      if (!recordsList.length) {
        lines.push(name+': not recorded.');
      } else {
        for (const r of recordsList) {
          lines.push(name+': ID '+text(r.testExecutionId)+
            ' · '+label(r.result)+' · method '+text(r.executionMethod)+
            ' · start '+text(r.startedAt)+
            ' · end '+text(r.completedAt)+
            (r.restrictedTestDetailsOmitted ? ' · sensitive details withheld, inspect private evidence.' : ''));
        }
      }
    }
    lines.push('Finding IDs: '+(list(c.findings).map(f=>text(f.findingId)).join(', ')||'None recorded')+'.');
    lines.push('Finding closure verified: '+(c.verifiedClosed===true?'YES':'NO')+
      '. Human evidence review and target-specific context remain necessary.');
    lines.push('');
  }
  lines.push('## 5. Evidence gaps, limitations and assessment quality', '');
  lines.push('Missing evidence records: '+count(quality.recordedMissingEvidenceItems)+
    ' (contents held in authorised ARL records; do not equate absence of details here with zero gaps).');
  if (list(report.limitations).length) {
    lines.push('', '**Recorded limitations:**');
    for(const item of list(report.limitations).slice(0,100)) {
      lines.push('- '+text(item,'Limitation details held in authoritative assessment'));
    }
  } else lines.push('No limitations list was provided in this projection. This is an unresolved completeness issue.');
  lines.push('', '**Customer report review gaps (not automatic findings):**');
  for(const item of quality.reportCompletenessGaps) lines.push('- '+text(item));
  lines.push('', '## 6. Retest and review obligations', '');
  lines.push('A finding can be closed only by authorised human review of exact-version retest and sufficient evidence. A code diff, vendor assertion, test status or LLM summary alone cannot close it.');
  lines.push('');
  lines.push('Final independent reviewer identity, conflict declaration, disagreements and review conclusion must be documented separately before customer delivery. This narrative does not assert that those steps occurred.');
  lines.push('', '## 7. Conclusion and claims boundary', '');
  lines.push('Evidence-supported readiness: '+label(readiness.status)+
    '. Recorded human decision: '+(readiness.finalDecisionRecorded===true?'present':'not present')+
    '. No certification, UKAS accreditation, unrestricted security assurance or new deployment decision is issued by this report.');
  lines.push('');
  lines.push('Security posture may be indeterminate where coverage, scope, tool side effects, applicability, independent authorisation or version-bound retesting remain unresolved.');
  if(report.disclaimer) lines.push('', '**Existing project disclaimer:** '+text(report.disclaimer));
  lines.push('', 'This report is a privacy-reduced read-only projection. Underlying source artefacts and authorised testing records must be independently retained and reviewed. An SHA-256 content digest is not a reviewer signature.');
  return lines.join('\n');
}
