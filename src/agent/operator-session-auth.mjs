import {
  authenticateUser,
  completeMfaLogin,
  createMfaLoginChallenge,
  createSession,
  getUserFromRequest
} from '../auth.js';
import { initialiseDatabase, nowIso } from '../db.js';

export {
  OPERATOR_SESSION_CACHE_SCHEMA,
  clearOperatorSessionCache,
  defaultOperatorSessionCachePath,
  loadOperatorSessionIntoEnv,
  readOperatorSessionCache,
  writeOperatorSessionCache
} from './operator-session-cache.mjs';

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function captureResponse() {
  const headers = new Map();
  return {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    }
  };
}

function extractSessionToken(response) {
  const raw = response.getHeader('Set-Cookie');
  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies.filter(Boolean)) {
    const match = String(cookie).match(/^arl_session=([^;]+)/);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return '';
      }
    }
  }
  return '';
}

function cleanSessionToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length < 32 || token.length > 512) return '';
  return token;
}

export async function authenticateOperatorSessionToken(sessionToken) {
  const token = cleanSessionToken(sessionToken);
  if (!token) return null;
  await initialiseDatabase();
  return getUserFromRequest({
    headers: {
      cookie: `arl_session=${encodeURIComponent(token)}`
    }
  });
}

export async function loginOperatorSession({
  email,
  password,
  mfaCode = ''
} = {}) {
  await initialiseDatabase();
  const operator = await authenticateUser(email, password);
  if (!operator?.id) {
    throw sessionError(
      'OPERATOR_AUTHENTICATION_REQUIRED',
      'A valid ARL operator account is required.'
    );
  }
  if (operator.emailVerified !== true) {
    throw sessionError(
      'OPERATOR_EMAIL_VERIFICATION_REQUIRED',
      'Verify the ARL operator email before creating a CLI session.'
    );
  }

  let mfaVerified = false;
  if (operator.mfaEnabled) {
    const code = String(mfaCode || '').trim();
    if (!code) {
      throw sessionError(
        'OPERATOR_MFA_CODE_REQUIRED',
        'This ARL operator account has MFA enabled. Provide ARL_OPERATOR_MFA_CODE for the one-time CLI login.'
      );
    }
    const challenge = await createMfaLoginChallenge(operator.id);
    const verifiedUserId = await completeMfaLogin(
      challenge.challengeToken,
      code
    );
    if (verifiedUserId !== operator.id) {
      throw sessionError(
        'OPERATOR_MFA_VERIFICATION_FAILED',
        'The MFA verification did not resolve to the authenticated operator.'
      );
    }
    mfaVerified = true;
  }

  const response = captureResponse();
  await createSession(response, operator.id, { mfaVerified });
  const sessionToken = extractSessionToken(response);
  if (!sessionToken) {
    throw sessionError(
      'OPERATOR_SESSION_ISSUANCE_FAILED',
      'ARL created a session but the CLI credential could not be captured.'
    );
  }

  const verified = await authenticateOperatorSessionToken(sessionToken);
  if (!verified?.id || verified.id !== operator.id) {
    throw sessionError(
      'OPERATOR_SESSION_VERIFICATION_FAILED',
      'The newly issued ARL operator session could not be verified.'
    );
  }
  if (verified.mfaEnabled && !verified.mfaVerified) {
    throw sessionError(
      'OPERATOR_MFA_VERIFICATION_REQUIRED',
      'The ARL operator session is not MFA-verified.'
    );
  }

  return {
    sessionToken,
    userId: verified.id,
    emailVerified: verified.emailVerified,
    mfaEnabled: verified.mfaEnabled,
    mfaVerified: verified.mfaVerified,
    createdAt: nowIso()
  };
}
