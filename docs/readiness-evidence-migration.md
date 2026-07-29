# Readiness evidence migration

Migration `005_readiness_evidence.sql` adds policy identity fields to projects and runtime events and creates the project-scoped remediation evidence registry. It is additive, runs inside the existing PostgreSQL migration transaction and is safe to discover more than once through the migration ledger. SQLite development databases use idempotent column/table creation.

Existing runtime events are preserved without fabricated policy identities. They cannot satisfy current-policy readiness. Republishing the project policy creates a canonical server-side digest and publication timestamp; new Guard events then carry that authoritative identity.

Existing remediation rows and `verification_json` are preserved. Legacy `verified`, `closed`, and `verified_closed` rows without a registered retest artifact are exposed as `evidence_upgrade_required` and keep readiness on hold. An authorised reviewer can start the upgrade once; the action appends actor, timestamp, old/new state and reason to history. A new current-policy runtime-event retest is required.

Rollback is intentionally limited: dropping the new columns or evidence table would discard newly registered readiness associations. Roll back application code only after confirming no new evidence records are required, and retain a database backup. Do not rewrite migration `005` after it has been applied because checksum verification will reject it.
