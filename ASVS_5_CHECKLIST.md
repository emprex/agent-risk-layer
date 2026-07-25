# OWASP ASVS 5.0 Internal Verification Checklist

This is an internal engineering mapping, not an independent ASVS certification.

| Control area | v4.2 evidence | Status |
|---|---|---|
| Architecture and threat modelling | Trust Centre, Inspector and Red Team architecture documents | Implemented internally |
| Authentication | Async scrypt, verified email, TOTP MFA, recovery codes | Implemented and tested |
| Session management | HTTP-only cookies, idle/absolute expiry, reauthentication | Implemented and tested |
| Access control | Ownership checks, admin role/email gate, verified-email gates | Implemented and tested |
| Input validation | Bounded JSON parsing, schema checks, malformed JSON 400 | Implemented and tested |
| Cryptography | SHA-256, HMAC token storage, Ed25519 bundles, AES-GCM MFA secret storage | Implemented and tested |
| Error handling and logging | Safe errors, operational alerts, no secret payload logging | Implemented internally |
| Data protection | Redaction, retention purge, legal holds, export/deletion | Implemented and tested |
| Communications | HTTPS-only production URLs and strict transport security | Platform/app configuration |
| Malicious code and supply chain | Local Inspector checks, exact container tag, release checksums | Implemented internally |
| Business logic | Durable payment fulfilment and reconciliation | Implemented and tested |
| Files and resources | Size limits, no symlink following, bounded scan scope | Implemented and tested |
| API and web services | CSRF, CSP, rate limits, webhook verification | Implemented and tested |
| Configuration | Production fail-closed checks and documented environment | Implemented and tested |

Remaining external work:

- Independent ASVS verification against the exact deployed release.
- Dynamic penetration testing and authenticated access-control review.
- Infrastructure and cloud configuration review.
- Formal evidence package signed by an independent assessor.
