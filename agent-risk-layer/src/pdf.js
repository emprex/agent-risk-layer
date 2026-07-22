function normalise(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrap(text, max = 88) {
  const words = normalise(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= max) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pdfEscape(text) {
  return normalise(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export async function renderReportPdf(report) {
  const blocks = [];
  const add = (text, size = 10, bold = false, indent = 0, gap = 4) => {
    const usablePoints = 490 - indent;
    const width = Math.max(20, Math.min(96, Math.floor(usablePoints / Math.max(4.8, size * 0.54))));
    for (const line of wrap(text, width)) blocks.push({ text: line, size, bold, indent, gap });
  };
  const heading = (text, level = 2) => add(text, level === 1 ? 20 : level === 2 ? 14 : 11, true, 0, 8);

  heading('AgentRiskLayer', 3);
  heading(report.title, 1);
  add(`Assessment date: ${report.created}`, 9);
  add(`Report generated: ${report.generated}`, 9);
  add(`Assessment ID: ${report.assessmentId}`, 9);
  add(`Scoring model: ${report.scoringVersion}`, 9);
  add(`Agent type: ${report.agentType}`, 9);
  heading(`Risk score: ${report.score}/100 - ${report.riskBand}`, 2);
  add(report.headline, 12, false, 0, 9);

  if (report.executiveBrief) {
    heading('Executive brief');
    add(`Deployment decision: ${report.executiveBrief.deploymentDecision}`, 10, true);
    add(`Control coverage: ${report.executiveBrief.controlCoverage}`);
    add(`Primary threats: ${report.executiveBrief.primaryThreats.join(', ')}`);
  }

  heading('Assessment responses');
  for (const response of report.responses || []) {
    add(`${response.title}`, 9, true, 0, 1);
    add(`${response.answer} (${response.points}/10 risk points)`, 8, false, 12, 4);
  }

  heading('Material findings');
  if (!report.findings.length) add('No material weaknesses were identified by the questionnaire.');
  for (const finding of report.findings) {
    add(`${finding.id} | ${finding.severity.toUpperCase()} | ${finding.title}`, 10, true, 0, 2);
    add(`Observed: ${finding.observed}`, 9, false, 12, 7);
  }

  heading('Control checklist');
  for (const control of report.controls) add(`${control.status === 'pass' ? 'PASS' : 'ACTION'} - ${control.name}`, 9, control.status !== 'pass');

  heading('Prioritised recommendations');
  report.recommendations.forEach((item, index) => add(`${index + 1}. [${item.priority}] ${item.text}`, 9));

  heading('30-day action plan');
  for (const phase of report.actionPlan) {
    add(phase.window, 10, true, 0, 2);
    phase.actions.forEach((action) => add(`- ${action}`, 9, false, 12, 2));
  }

  if (report.verificationChecklist) {
    heading('Verification checklist');
    for (const item of report.verificationChecklist) {
      add(`${item.id} - ${item.control}`, 9, true, 0, 2);
      add(`Evidence required: ${item.evidence}`, 8, false, 12, 5);
    }
    heading('Retest criteria');
    report.retestCriteria.forEach((item) => add(`- ${item}`, 9));
  }

  heading('Methodology');
  add(report.methodology, 9);
  heading('Reference basis');
  for (const item of report.referenceBasis || []) add(`- ${item}`, 9);
  heading('Assumptions and limitations');
  for (const item of report.limitations || []) add(`- ${item}`, 9);
  heading('Important notice');
  add(report.disclaimer, 8);

  const pages = [];
  let page = [];
  let y = 790;
  for (const block of blocks) {
    const lineHeight = block.size + block.gap;
    if (y - lineHeight < 55) {
      pages.push(page);
      page = [];
      y = 790;
    }
    page.push({ ...block, y });
    y -= lineHeight;
  }
  if (page.length) pages.push(page);

  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const kids = [];
  pages.forEach((lines, index) => {
    const contentId = 5 + index * 2;
    const pageId = contentId + 1;
    kids.push(`${pageId} 0 R`);
    const commands = [];
    commands.push('0.07 0.09 0.12 rg 48 806 499 1 re f');
    for (const line of lines) {
      const font = line.bold ? 'F2' : 'F1';
      commands.push(`BT /${font} ${line.size} Tf 0.08 0.10 0.12 rg 1 0 0 1 ${48 + line.indent} ${line.y} Tm (${pdfEscape(line.text)}) Tj ET`);
    }
    commands.push(`BT /F1 8 Tf 0.4 0.45 0.43 rg 1 0 0 1 48 28 Tm (AgentRiskLayer - Page ${index + 1} of ${pages.length}) Tj ET`);
    const stream = commands.join('\n');
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objects.set(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);

  const maxId = Math.max(...objects.keys());
  let output = '%PDF-1.4\n%ARL1\n';
  const offsets = [0];
  for (let objectId = 1; objectId <= maxId; objectId++) {
    offsets[objectId] = Buffer.byteLength(output);
    output += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId <= maxId; objectId++) output += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, 'binary');
}
