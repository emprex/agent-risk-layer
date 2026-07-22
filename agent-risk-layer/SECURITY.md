# Security Policy

## Reporting a vulnerability

Configure `SUPPORT_EMAIL` before deployment. Security researchers should send a concise description, affected route, reproduction steps and impact. Do not include live customer data.

The deployed application publishes the configured contact at:

```text
/.well-known/security.txt
```

## Supported release

Security fixes are applied to the current `1.1.x` launch-beta line.

## Operational requirements

- Run only behind HTTPS in production.
- Keep `DEMO_MODE=false` in production.
- Rotate `SESSION_SECRET` through a controlled session-invalidation process if exposed.
- Restrict production database and environment-secret access.
- Back up the SQLite database to a separate encrypted location.
- Alert on repeated authentication failures, webhook failures and email delivery failures.
- Review Stripe and Resend dashboard activity independently of application logs.
- Test restore procedures, password recovery, account deletion and billing cancellation regularly.

## Security boundaries

The included controls reduce common web-application risk but do not establish that the product is free of vulnerabilities. Independent penetration testing and infrastructure review remain required before a public launch.
