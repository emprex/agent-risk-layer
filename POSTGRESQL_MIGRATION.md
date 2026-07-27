# PostgreSQL conversion and migration control

## Architecture

Production uses the `pg` connection pool and `DATABASE_URL`. SQL placeholders are translated to PostgreSQL parameters, transactions use connection-bound `BEGIN/COMMIT/ROLLBACK`, and SQLite-only statements are rejected by the adapter.

## Schema migrations

- `001_initial_schema.sql`: complete current schema
- `002_indexes_and_backfill.sql`: indexes and safe data backfills
- `003_security_control_plane.sql`: projects, API keys, runtime evidence, inventory drift, remediation and audit history
- `schema_migrations`: applied version and immutable checksum
- PostgreSQL advisory transaction lock prevents concurrent deploys from racing migrations

Never edit an applied migration. Add a new numbered migration for later schema changes.

## Existing SQLite data

The release does not automatically ingest an old filesystem database into production. Before switching a live installation that contains real records:

1. stop writes to the old service;
2. retain an immutable final legacy backup;
3. create the managed PostgreSQL database and apply this release’s schema;
4. migrate records with an owner-approved, separately validated data-transfer procedure;
5. reconcile table counts, foreign keys, assessment/report digests, legacy registration records, subscriptions and fulfilment records;
6. keep the old service read-only until the reconciliation is signed off;
7. do not attach the old disk to the new production service.

For a new public deployment with no customer records to preserve, deploy to a clean PostgreSQL database.
