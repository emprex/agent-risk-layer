#!/usr/bin/env bash
# ENK-08 full-schema (NO customer rows) rehearsal on disposable PG17.
# Usage: pg_virtualenv -v 17 bash scripts/enkyron-enk08-schema-only-rehearsal.sh
# No writes to arl_local. Clone is destroyed by pg_virtualenv.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
die() { printf 'ENK-08 SCHEMA REHEARSAL STOP: %s\n' "$1" >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || die 'Do not run as root'
[[ "${PGVERSION:-}" == 17 ]] || die 'Requires pg_virtualenv PostgreSQL 17'
[[ "${PGHOST:-}" == localhost ]] || die 'Requires local virtual cluster'
[[ "${PGPORT:-}" =~ ^[0-9]{4,5}$ ]] || die 'Missing dynamic port'
(( PGPORT > 5432 && PGPORT < 65536 )) || die 'Refusing the main 5432 port'
[[ -n "${PGUSER:-}" && -n "${PGPASSWORD:-}" ]] || die 'Missing temporary operator credentials'
conf_root="${PG_CLUSTER_CONF_ROOT:-}"
[[ "$conf_root" == /*/pg_virtualenv.*/postgresql ]] || die 'Not a virtual cluster config'
[[ -f "$conf_root/17/regress/.by_pg_virtualenv" ]] || die 'Virtual cluster marker missing'
work_root="${conf_root%/postgresql}"
for bin in node git psql pg_dump pg_virtualenv createdb; do
  command -v "$bin" >/dev/null || die "Missing required tool: $bin"
done
unset PGHOSTADDR PGSERVICE PGCLUSTER PGOPTIONS
psql_temp() {
  local db="$1"; shift
  psql -X -w -v ON_ERROR_STOP=1 -h localhost -p "$PGPORT" -U "$PGUSER" -d "$db" "$@"
}
# Verify actual temporary server configuration and data dir before ANY write.
conf_file="$(psql_temp postgres -Atc 'SHOW config_file')"
data_dir="$(psql_temp postgres -Atc 'SHOW data_directory')"
server_port="$(psql_temp postgres -Atc 'SHOW port')"
[[ "$conf_file" == "$conf_root/17/regress/postgresql.conf" ]] || die 'Wrong temp config'
[[ "$data_dir" == "$work_root/"* ]] || die 'Wrong temp data directory'
[[ "$server_port" == "$PGPORT" ]] || die 'Unexpected temp server port'

# Pinned Git blob hashes from the reviewed feature branch; checks working tree too.
paths=(
 migrations/114_enkyron_crm_proposal_content_versions.sql
 migrations/115_enkyron_crm_proposal_archive_event_binding.sql
 migrations/117_enkyron_mail_document_dossier_links.sql
 docs/enkyron/sql/118_enkyron_psa_mission_planning.sql
 docs/enkyron/sql/119_enkyron_psa_work_items.sql
 docs/enkyron/sql/120_enkyron_psa_time_entries.sql
)
hashes=(
 d710e9851c2762c6cdc57b5c251afa2ffa2ffda3
 0b49d23d84ece91012820f82e17455f436e06318
 ad2091e15b4529074b1b68d76fc4fd391cad3e88
 d5bfe298b245d134b6d3f7a1e652fd9ae1270324
 33689aa941d16b3bd29ae74fd9ffa0d07bfefee6
 e01f1ba4342a82b0eb180cd896af4156000c68f7
)
for i in "${!paths[@]}"; do
  [[ -f "${paths[$i]}" ]] || die "Missing: ${paths[$i]}"
  [[ "$(git hash-object -- "${paths[$i]}")" == "${hashes[$i]}" ]] ||
    die "Reviewed SQL was modified: ${paths[$i]}"
done
for n in 118_enkyron_psa_mission_planning.sql 119_enkyron_psa_work_items.sql 120_enkyron_psa_time_entries.sql; do
  [[ ! -e "migrations/$n" ]] || die "Unapproved PSA schema in active migrations: $n"
done

# The live DB schema and migration ledger are always READ ONLY.
node --input-type=module <<'NODE'
import {preflightBusinessDatabase} from './scripts/enkyron-business-migration-preflight.mjs';
import {auditEnk08Historical021} from './scripts/enkyron-enk08-history-021-audit.mjs';
const report = await preflightBusinessDatabase();
const history = await auditEnk08Historical021();
const pending = [
 '114_enkyron_crm_proposal_content_versions.sql',
 '115_enkyron_crm_proposal_archive_event_binding.sql',
 '117_enkyron_mail_document_dossier_links.sql',
].sort();
if (report.checksum_mismatch.length ||
 JSON.stringify(report.pending) !== JSON.stringify(pending) ||
 JSON.stringify(report.missing_source) !== JSON.stringify(['021_paid_assessment_remediation_scope.sql']) ||
 !history.provenance_verified_for_review) {
 console.error('ENK-08 STOP: migration ledger changed since review');
 process.exit(2);
}
console.log('ENK-08: historical ledger matches the reviewed release STOP baseline');
NODE

# Independent identity check for the schema-only pg_dump source.
operator="$(id -un)"
live_id="$(env PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000' \
 psql -X -w -h /var/run/postgresql -p 5432 -U "$operator" -d arl_local -At \
 -c "SELECT current_database()||'|'||current_user||'|'||current_setting('transaction_read_only')||'|'||current_setting('port')")"
[[ "$live_id" == "arl_local|${operator}|on|5432" ]] || die 'Unexpected source database'

clone_db='enk08_schema_rehearsal'
# ONLY the independently checked disposable server receives a CREATE DATABASE.
createdb -h localhost -p "$PGPORT" -U "$PGUSER" -T template0 "$clone_db"
[[ "$(psql_temp "$clone_db" -Atc 'SELECT current_database()')" == "$clone_db" ]] ||
 die 'Wrong temporary clone identity'

printf 'ENK-08: importing SCHEMA ONLY to disposable port %s; no customer rows\n' "$PGPORT"
env PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000' \
 pg_dump -h /var/run/postgresql -p 5432 -U "$operator" -d arl_local \
 --schema-only --no-owner --no-acl --no-tablespaces \
 --no-publications --no-subscriptions --no-comments |
 psql_temp "$clone_db" -q

required=(
 enkyron_crm_companies enkyron_crm_opportunities
 enkyron_crm_proposal_drafts enkyron_crm_proposal_draft_events
 enkyron_mail_attachment_quarantine arl_workbench_tickets
)
for name in "${required[@]}"; do
 [[ "$(psql_temp "$clone_db" -Atc "SELECT to_regclass('public.$name') IS NOT NULL")" == t ]] ||
 die "Missing dependency in clone: $name"
done
for name in enkyron_crm_proposal_content_versions enkyron_mail_document_dossier_links enkyron_psa_missions; do
 [[ "$(psql_temp "$clone_db" -Atc "SELECT to_regclass('public.$name') IS NULL")" == t ]] ||
 die "Proposed object already exists in clone: $name"
done

printf 'ENK-08: rehearsing six pinned files ONLY in disposable clone\n'
psql_temp "$clone_db" -q -1 \
 -f "${paths[0]}" -f "${paths[1]}" -f "${paths[2]}" \
 -f "${paths[3]}" -f "${paths[4]}" -f "${paths[5]}"

count="$(psql_temp "$clone_db" -Atc "
SELECT count(*) FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
AND c.relname IN (
 'enkyron_crm_proposal_content_versions','enkyron_mail_document_dossier_links',
 'enkyron_psa_missions','enkyron_psa_mission_events',
 'enkyron_psa_work_items','enkyron_psa_work_item_events',
 'enkyron_psa_time_entries','enkyron_psa_time_events'
)")"
[[ "$count" == 8 ]] || die "Expected 8 created tables, got $count"
printf 'ENK-08 SCHEMA-ONLY REHEARSAL PASSED on disposable PostgreSQL 17\n'
printf 'ENK-08 LIVE RELEASE STOP: No data was cloned; restore and RBAC not validated\n'
