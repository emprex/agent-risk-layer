import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
