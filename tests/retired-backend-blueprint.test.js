import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('retired backend blueprint remains absent', () => {
  assert.equal(fs.existsSync('render.yaml'), false);
});
