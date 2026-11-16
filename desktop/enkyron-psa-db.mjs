// ENK-08 local database utilities. Trusted actor comes from the local bridge;
// none of these helpers provide remote authentication or tenant RBAC.
const ACTOR = /^[A-Za-z0-9_.-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function psaLocalScope(actor) {
  if (typeof actor !== 'string' || !ACTOR.test(actor)) {
    throw new Error('PSA invalid trusted local operator');
  }
  return {workspace: 'local:' + actor, actor};
}

export function psaUuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error('PSA invalid ' + name);
  }
  return value.toLowerCase();
}

export async function psaTransaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const response = await action(client);
    await client.query('COMMIT');
    return response;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
