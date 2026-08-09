import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { reportCoverEvidenceLine } from '../src/pdf.js';

const file = path.resolve(import.meta.dirname, '..', 'public', 'downloads', 'agentrisklayer-sample-professional-report.pdf');

test('sample Professional PDF includes metadata, section bookmarks and bounded pagination', () => {
  const pdf = fs.readFileSync(file);
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  const source = pdf.toString('latin1');
  assert.match(source, /\/Outlines \d+ 0 R/);
  assert.match(source, /\/PageMode \/UseOutlines/);
  assert.match(source, /\/Title \(SAMPLE - Finance Operations Agent Security Assessment\)/);
  const pageCount = (source.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pageCount >= 10 && pageCount <= 18, `unexpected sample report page count: ${pageCount}`);
});

test('report cover describes only evidence actually attached', () => {
  assert.equal(
    reportCoverEvidenceLine({}),
    'Structured self-assessment | Declared evidence | No technical testing attached',
  );
  assert.equal(
    reportCoverEvidenceLine({ inspection: {} }),
    'Evidence-led review | Local static inspection | No adversarial test attached',
  );
  assert.equal(
    reportCoverEvidenceLine({ redTeam: { campaign: { target: { mode: 'staging-adapter' } } } }),
    'Evidence-led review | No static inspection | Controlled adversarial testing',
  );
  assert.equal(
    reportCoverEvidenceLine({ inspection: {}, redTeam: { campaign: { target: { mode: 'staging-adapter' } } } }),
    'Evidence-led review | Local static inspection | Controlled adversarial testing',
  );
  assert.equal(
    reportCoverEvidenceLine({ redTeam: { campaign: { target: { mode: 'simulator' } } } }),
    'Structured self-assessment | Runner simulation | No assessed-system testing',
  );
  assert.equal(
    reportCoverEvidenceLine({ inspection: {}, redTeam: { campaign: { target: { mode: 'simulator' } } } }),
    'Evidence-led review | Local static inspection | Runner simulation',
  );
});
