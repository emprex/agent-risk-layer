#!/usr/bin/env bash
# ENK-08: one-command, NON-PRODUCTION review checks on Debian.
# Runs Python syntax/widget checks and the guarded disposable PG17+Node suite.
# Does not call production bridge, runMigrations or touch arl_local.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

die() { printf 'ENK-08 CHECK STOP: %s\n' "$1" >&2; exit 2; }
[[ "$(id -u)" != "0" ]] || die 'Run as your normal Debian user, not root'
command -v python3 >/dev/null || die 'Python 3 is missing'
command -v node >/dev/null || die 'Node.js is missing'
command -v pg_virtualenv >/dev/null || die 'Debian pg_virtualenv helper missing'

printf '\nENK-08 (1/3): Python syntax and native GUI presentation tests\n'
python3 -m py_compile \
  desktop/enkyron.py \
  desktop/enkyron_mission_board.py \
  desktop/enkyron_mission_board_model.py
QT_QPA_PLATFORM=offscreen python3 -m unittest discover \
  -s desktop -p 'test_enkyron_mission_board_*.py' -v

printf '\nENK-08 (2/3): Node service syntax\n'
for filename in \
    desktop/enkyron-psa-planning-contract.mjs \
    desktop/enkyron-psa-missions.mjs \
    desktop/enkyron-psa-work-items.mjs \
    desktop/enkyron-psa-time.mjs; do
  node --check "$filename"
done

printf '\nENK-08 (3/3): temporary PostgreSQL 17 + combined Node tests\n'
pg_virtualenv -v 17 bash scripts/enkyron-psa-virtualenv-rehearsal.sh
printf '\nENK-08 REVIEW CHECKS PASSED (synthetic only; live deployment still blocked)\n'
