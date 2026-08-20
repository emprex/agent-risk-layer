import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/control-plane-bootstrap.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('an existing exact assessment case resumes even before any remediation item exists', () => {
  assert.match(bootstrap, /item\?\.projectKind === 'assessment_case' && item\?\.assessmentId === assessmentId/);
  assert.match(bootstrap, /return exactCase;/);
  assert.match(bootstrap, /resumeExactAssessmentScope\(exactCase\);/);
  assert.match(bootstrap, /select\.value = exactCase\.id;/);
  assert.match(bootstrap, /form\.requestSubmit\(\)/);
});

test('assessment scope resume ships behind a fresh bootstrap asset version', () => {
  assert.match(page, /control-plane-bootstrap\.js\?v=20260820\.3/);
});
