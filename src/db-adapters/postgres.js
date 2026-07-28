import { AsyncLocalStorage } from 'node:async_hooks';

function translatePlaceholders(sql) {
  let index = 0;
  let output = '';
  let single = false;
  let double = false;
  let dollarTag = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (!single && !double && !dollarTag && char === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      if (end === -1) return output + sql.slice(i);
      output += sql.slice(i, end + 1);
      i = end;
      continue;
    }
    if (!single && !double && !dollarTag && char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return output + sql.slice(i);
      output += sql.slice(i, end + 2);
      i = end + 1;
      continue;
    }
    if (!single && !double && char === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        if (!dollarTag) dollarTag = match[0];
        else if (dollarTag === match[0]) dollarTag = '';
        output += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    if (!double && !dollarTag && char === "'") {
      if (single && next === "'") {
        output += "''";
        i += 1;
        continue;
      }
      single = !single;
      output += char;
      continue;
    }
    if (!single && !dollarTag && char === '"') {
      double = !double;
      output += char;
      continue;
    }
    if (!single && !double && !dollarTag && char === '?') {
      index += 1;
      output += `$${index}`;
      continue;
    }
    output += char;
  }
  return output;
}

function assertPortableSql(sql) {
  if (/\bPRAGMA\b|\bBEGIN\s+IMMEDIATE\b|\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/i.test(sql)) {
    throw new Error(`SQLite-only SQL is not permitted in PostgreSQL mode: ${sql.slice(0, 120)}`);
  }
}

export async function createPostgresDatabase(config, dependencies = {}) {
  const pg = dependencies.Pool ? dependencies : await import('pg');
  const { Pool } = pg;
  pg.types?.setTypeParser?.(20, (value) => Number(value));
  const transactionContext = new AsyncLocalStorage();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    allowExitOnIdle: config.nodeEnv === 'test',
    ssl: config.databaseSsl ? { rejectUnauthorized: config.databaseSslRejectUnauthorized } : false,
    options: [
      '-c', 'timezone=UTC',
      '-c', `statement_timeout=${Math.max(1000, config.databaseStatementTimeoutMs)}`,
      '-c', `lock_timeout=${Math.max(1000, config.databaseLockTimeoutMs)}`,
    ].join(' '),
  });

  const execute = async (sql, params = []) => {
    assertPortableSql(sql);
    const translated = translatePlaceholders(sql);
    const store = transactionContext.getStore();
    const executor = store?.client || pool;
    return executor.query(translated, params);
  };

  const adapter = {
    kind: 'postgres',
    pool,
    prepare(sql) {
      return {
        async get(...params) {
          const result = await execute(sql, params);
          return result.rows[0];
        },
        async all(...params) {
          const result = await execute(sql, params);
          return result.rows;
        },
        async run(...params) {
          const result = await execute(sql, params);
          return { changes: Number(result.rowCount || 0), lastInsertRowid: null, rows: result.rows };
        },
      };
    },
    async exec(sql) {
      await execute(sql, []);
    },
    async query(sql, params = []) {
      return execute(sql, params);
    },
    async transaction(callback) {
      const existing = transactionContext.getStore();
      if (existing?.client) return callback(adapter);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionContext.run({ client }, () => callback(adapter));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async healthcheck() {
      const started = Date.now();
      const result = await pool.query('SELECT current_database() AS database, current_user AS user, version() AS version');
      return { ok: true, adapter: 'postgres', latencyMs: Date.now() - started, ...result.rows[0] };
    },
    async close() {
      await pool.end();
    },
  };

  return adapter;
}

export { translatePlaceholders };
