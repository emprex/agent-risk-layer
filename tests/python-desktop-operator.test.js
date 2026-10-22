import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Python desktop Operator passes headless read-only regressions', t => {
  const result = spawnSync(
    'python3',
    ['-m', 'unittest', 'discover', '-s', 'desktop', '-p', 'test_*.py'],
    {
      cwd: root,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 20_000
    }
  );
  if (result.error?.code === 'ENOENT') {
    t.skip('python3 is unavailable on this runner');
    return;
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stderr, /OK\s*$/);
});

test('Python desktop Operator prints diagnostics without a graphical display', t => {
  const result = spawnSync('python3', [
    'desktop/arl_operator.py', '--check'
  ], {
    cwd: root,
    env: {
      ...process.env,
      DISPLAY: '',
      DATABASE_URL: 'postgresql://TEST_ONLY_SECRET@127.0.0.1/unknown',
      PYTHONDONTWRITEBYTECODE: '1'
    },
    encoding: 'utf8',
    timeout: 15_000
  });
  if (result.error?.code === 'ENOENT') {
    t.skip('python3 is unavailable on this runner');
    return;
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const data = JSON.parse(result.stdout);
  assert.equal(data.mode, 'read_only_gui_foundation');
  assert.equal(data.postgresql, 'not_checked');
  assert.equal(data.assessment, 'not_loaded');
  assert.equal(data.active_tests, 'not_available');
  assert.equal(data.decisions, 'not_available');
  assert.doesNotMatch(result.stdout + result.stderr, /TEST_ONLY_SECRET/);
});
