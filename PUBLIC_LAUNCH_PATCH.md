# Public access implementation

AgentRiskLayer v9.1 uses public self-service account creation. The registration path keeps email verification, scrypt password hashing, CSRF protection, rate limiting, secure sessions and optional MFA.

The previous restricted-registration routes are retired. A legacy database table remains only to preserve safe migration compatibility and is not reachable through the application.
