import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OPERATOR_SESSION_CACHE_SCHEMA =
  'arl.agent.operator-session-cache.v1';

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanSessionToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length < 32 || token.length > 512) return '';
  return token;
}

function cleanServerUrl(value) {
  const serverUrl = String(value || '').trim();
  if (!serverUrl) return '';
  if (serverUrl.length > 2048) {
    throw sessionError(
      'OPERATOR_SESSION_SERVER_URL_INVALID',
      'The cached ARL server URL is too long.'
    );
  }
  return serverUrl;
}

export function defaultOperatorSessionCachePath({
  env = process.env,
  homeDirectory = os.homedir()
} = {}) {
  const configured = String(env.ARL_OPERATOR_SESSION_FILE || '').trim();
  if (configured) return path.resolve(configured);

  const xdg = String(env.XDG_CONFIG_HOME || '').trim();
  const configRoot = xdg
    ? path.resolve(xdg)
    : path.join(path.resolve(homeDirectory), '.config');
  return path.join(configRoot, 'agentrisklayer', 'operator-session.json');
}

export function writeOperatorSessionCache({
  sessionToken,
  serverUrl = '',
  filePath = defaultOperatorSessionCachePath(),
  createdAt = new Date().toISOString()
} = {}) {
  const token = cleanSessionToken(sessionToken);
  if (!token) {
    throw sessionError(
      'OPERATOR_SESSION_TOKEN_INVALID',
      'A valid ARL operator session token is required.'
    );
  }

  const cachedServerUrl = cleanServerUrl(serverUrl);
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const directoryExisted = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!directoryExisted && process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700);
  }

  const payloadObject = {
    schema: OPERATOR_SESSION_CACHE_SCHEMA,
    sessionToken: token,
    createdAt
  };
  if (cachedServerUrl) payloadObject.serverUrl = cachedServerUrl;

  const payload = `${JSON.stringify(payloadObject, null, 2)}\n`;
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, payload, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, resolved);
  if (process.platform !== 'win32') fs.chmodSync(resolved, 0o600);

  return {
    available: true,
    filePath: resolved,
    schema: OPERATOR_SESSION_CACHE_SCHEMA,
    tokenStored: true,
    serverUrlStored: Boolean(cachedServerUrl),
    passwordStored: false,
    mfaCodeStored: false
  };
}

export function readOperatorSessionCache({
  filePath = defaultOperatorSessionCachePath()
} = {}) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      available: false,
      filePath: resolved
    };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw sessionError(
      'OPERATOR_SESSION_CACHE_INVALID',
      'The ARL operator session cache must be a regular file.'
    );
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw sessionError(
      'OPERATOR_SESSION_CACHE_PERMISSIONS_UNSAFE',
      'The ARL operator session cache must not be readable or writable by group or other users.'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    throw sessionError(
      'OPERATOR_SESSION_CACHE_INVALID',
      'The ARL operator session cache is not valid JSON.'
    );
  }

  const token = cleanSessionToken(parsed?.sessionToken);
  if (parsed?.schema !== OPERATOR_SESSION_CACHE_SCHEMA || !token) {
    throw sessionError(
      'OPERATOR_SESSION_CACHE_INVALID',
      'The ARL operator session cache is malformed or uses an unsupported schema.'
    );
  }

  return {
    available: true,
    filePath: resolved,
    schema: parsed.schema,
    sessionToken: token,
    serverUrl: cleanServerUrl(parsed?.serverUrl),
    createdAt: parsed.createdAt || null
  };
}

export function loadOperatorSessionIntoEnv({
  env = process.env,
  filePath = defaultOperatorSessionCachePath({ env })
} = {}) {
  const explicitToken = cleanSessionToken(env.ARL_OPERATOR_SESSION_TOKEN);
  const explicitServerUrl = String(env.ARL_SERVER_URL || '').trim();
  if (explicitToken && explicitServerUrl) {
    return {
      loaded: false,
      source: 'environment',
      filePath: null,
      serverUrlLoaded: false
    };
  }

  const cached = readOperatorSessionCache({ filePath });
  if (!cached.available) {
    return {
      loaded: false,
      source: explicitToken ? 'environment' : 'none',
      filePath: cached.filePath,
      serverUrlLoaded: false
    };
  }

  let loaded = false;
  let serverUrlLoaded = false;
  if (!explicitToken) {
    env.ARL_OPERATOR_SESSION_TOKEN = cached.sessionToken;
    loaded = true;
  }
  if (!explicitServerUrl && cached.serverUrl) {
    env.ARL_SERVER_URL = cached.serverUrl;
    serverUrlLoaded = true;
  }

  return {
    loaded,
    source: loaded || serverUrlLoaded ? 'secure_cache' : 'environment',
    filePath: cached.filePath,
    serverUrlLoaded
  };
}

export function clearOperatorSessionCache({
  filePath = defaultOperatorSessionCachePath()
} = {}) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { force: true });
  return { cleared: true, filePath: resolved };
}
