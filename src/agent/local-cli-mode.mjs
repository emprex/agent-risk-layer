let localCliModeEnabled = false;

// In-process capability boundary for the product-owned local Operator.
// This flag does not select a database adapter. Local product persistence
// remains PostgreSQL through DATABASE_URL.
export function enableLocalCliMode(env = process.env) {
  if (env.ARL_LOCAL_MODE !== '1') {
    throw new Error('ARL_LOCAL_MODE=1 is required.');
  }
  localCliModeEnabled = true;
}

export function isLocalCliModeEnabled() {
  return localCliModeEnabled;
}
