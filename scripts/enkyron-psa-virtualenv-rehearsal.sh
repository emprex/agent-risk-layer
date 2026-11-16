#!/usr/bin/env bash
# ENK-08 disposable PostgreSQL rehearsal. Run through:
#   pg_virtualenv -v 17 bash scripts/enkyron-psa-virtualenv-rehearsal.sh
# Never use with sudo. This script refuses 17/main and all port-5432 connections.
set -euo pipefail

die() { printf 'ENK-08 CI STOP: %s\n' "$1" >&2; exit 2; }
[[ "$(id -u)" != "0" ]] || die 'Run as normal Debian operator, not root'
[[ "${PGVERSION:-}" == "17" ]] || die 'Requires pg_virtualenv PostgreSQL 17'
[[ "${PGHOST:-}" == "localhost" ]] || die 'Requires pg_virtualenv local host'
[[ "${PGPORT:-}" =~ ^[0-9]{4,5}$ ]] || die 'Missing temporary PostgreSQL port'
(( PGPORT > 5432 && PGPORT < 65536 )) || die 'Refusing port 5432 or invalid port'
[[ -n "${PGUSER:-}" && -n "${PGPASSWORD:-}" ]] || die 'Missing pg_virtualenv credentials'

conf_root="${PG_CLUSTER_CONF_ROOT:-}"
[[ "$conf_root" == /*/pg_virtualenv.*/postgresql ]] ||
  die 'PG_CLUSTER_CONF_ROOT is not a temporary pg_virtualenv path'
marker="$conf_root/17/regress/.by_pg_virtualenv"
[[ -f "$marker" ]] || die 'No pg_virtualenv-owned cluster marker found'
work_dir="${conf_root%/postgresql}"

command -v psql >/dev/null || die 'psql is required'
command -v node >/dev/null || die 'Node.js is required'
node -e "import('pg')" >/dev/null || die 'Node PostgreSQL package missing'
[[ -f docs/enkyron/sql/118_enkyron_psa_mission_planning.sql ]] ||
  die 'Missing review-only SQL'
[[ ! -e migrations/118_enkyron_psa_mission_planning.sql ]] ||
  die 'Unapproved 118 SQL must not be in migrations/'

# Remove inherited client overrides. All connections below specify host and port.
unset PGOPTIONS PGHOSTADDR PGSERVICE PGCLUSTER
psql_tmp() {
  psql -X -w -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" \
    -U "$PGUSER" -d postgres "$@"
}

# Verify the *server*, not only its client-side environment, before any SQL write.
config_path="$(psql_tmp -Atc 'SHOW config_file')"
data_path="$(psql_tmp -Atc 'SHOW data_directory')"
server_port="$(psql_tmp -Atc 'SHOW port')"
[[ "$config_path" == "$conf_root/17/regress/postgresql.conf" ]] ||
  die 'Server config path does not belong to virtual cluster'
[[ "$data_path" == "$work_dir/"* ]] ||
  die 'Server data path does not belong to virtual cluster'
[[ "$server_port" == "$PGPORT" ]] || die 'Unexpected server port'
printf 'ENK-08 CI: verified disposable cluster on port %s\n' "$PGPORT"

# Create the fixed test role/database only in the validated ephemeral cluster.
psql_tmp -c "CREATE ROLE arl_ci LOGIN PASSWORD 'synthetic-ci-only'"
psql_tmp -c 'CREATE DATABASE arl_ci OWNER arl_ci TEMPLATE template0'

export CI=true
export ARL_CI_POSTGRES_URL="postgresql://arl_ci:synthetic-ci-only@127.0.0.1:${PGPORT}/arl_ci"
node --test \
  tests/enkyron-psa-planning-contract.test.js \
  tests/enkyron-psa-missions.test.js \
  tests/enkyron-psa-missions-postgres.test.js
