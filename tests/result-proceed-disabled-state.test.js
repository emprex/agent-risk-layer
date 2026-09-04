import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/result-light-fix.css', import.meta.url), 'utf8');

test('blocked Proceed decision is visibly inert instead of looking busy', () => {
  assert.match(css, /#deploymentReview button\[data-deployment-decision="proceed"\]:disabled/);
  assert.match(css, /cursor:\s*default\s*!important/);
  assert.match(css, /opacity:\s*\.48\s*!important/);
});
