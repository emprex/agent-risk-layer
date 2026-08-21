import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('default SQLite test databases are unique across independent application loads', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_PATH;

  try {
    const first = await import(`../src/config.js?test-db-isolation=${crypto.randomUUID()}`);
    const second = await import(`../src/config.js?test-db-isolation=${crypto.randomUUID()}`);

    assert.notEqual(first.config.databasePath, second.config.databasePath);
    assert.match(first.config.databasePath, /test-\d+-[0-9a-f-]{36}\.sqlite$/i);
    assert.match(second.config.databasePath, /test-\d+-[0-9a-f-]{36}\.sqlite$/i);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  }
});
