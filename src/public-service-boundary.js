export const PUBLIC_SERVICE_ALLOWED_PATHS = new Set([
  '/api/health',
  '/api/ready',
  '/metrics',
  '/api/assessment-request'
]);

export function isPublicServiceRestrictedPath(pathname) {
  const value = String(pathname || '');
  if (PUBLIC_SERVICE_ALLOWED_PATHS.has(value)) return false;
  return value.startsWith('/api/')
    || value.startsWith('/v1/')
    || value.startsWith('/scim/');
}
