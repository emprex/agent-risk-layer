#!/usr/bin/env bash
# One-off operator-authorized cleanup of two explicitly named synthetic CRM cases.
# Keeps other companies, opportunities and their records. Fails closed.
set -euo pipefail
if [[ $(id -un) != emprex ]]; then echo 'Refused: wrong operator' >&2; exit 1; fi
if [[ $(psql -X -d arl_local -Atqc 'select current_database() || chr(58) || current_user') != 'arl_local:emprex' ]]; then
  echo 'Refused: wrong local PostgreSQL database or role' >&2; exit 1
fi
umask 077
backup_dir="$HOME/.local/share/enkyron/backups"
mkdir -p "$backup_dir"
backup="$backup_dir/arl_local-before-test-dossier-purge-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump -h /var/run/postgresql -U emprex -d arl_local -Fc -f "$backup"
pg_restore --list "$backup" >/dev/null
echo "Backup: $backup"
psql -X -d arl_local -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '6s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE purge_rows (
  relid oid NOT NULL,
  row_tid tid NOT NULL,
  PRIMARY KEY (relid,row_tid)
) ON COMMIT DROP;
DO $cleanup$
DECLARE
  fk record;
  target record;
  saved record;
  extra integer;
  added integer;
  progressed integer;
  pass integer;
  clause text;
BEGIN
  IF current_database() <> 'arl_local' OR current_user <> 'emprex' THEN
    RAISE EXCEPTION 'Wrong database identity';
  END IF;

  INSERT INTO purge_rows
  SELECT 'enkyron_crm_opportunities'::regclass::oid, ctid
  FROM enkyron_crm_opportunities
  WHERE workspace_key='local:emprex'
    AND ((
      id='7c03cdbf-dafe-47b0-b732-c8973b5a57ab'
      AND company_id='3b2a6e9a-8d53-4409-ad32-ab2d59398c1b'
      AND company_name_at_creation='ARL E2E Test 0711'
    ) OR (
      id='88434ffe-a75f-450d-8fb9-923484ed3130'
      AND prospect_id='lead_2e6edc598df744e085f9c40cb6e1c85b'
      AND company_name_at_creation='inference.sh'
    ));
  IF (SELECT count(*) FROM purge_rows) <> 2 THEN
    RAISE EXCEPTION 'Two named test opportunities not found exactly';
  END IF;

  INSERT INTO purge_rows
  SELECT 'enkyron_crm_companies'::regclass::oid, ctid
  FROM enkyron_crm_companies
  WHERE workspace_key='local:emprex'
    AND id='3b2a6e9a-8d53-4409-ad32-ab2d59398c1b'
    AND name='ARL E2E Test 0711';
  INSERT INTO purge_rows
  SELECT 'sales_prospects'::regclass::oid, ctid
  FROM sales_prospects
  WHERE id='lead_2e6edc598df744e085f9c40cb6e1c85b'
    AND company_name='inference.sh';
  IF (SELECT count(*) FROM purge_rows) <> 4 THEN
    RAISE EXCEPTION 'Exact company/research record not found; nothing deleted';
  END IF;

  FOR pass IN 1..80 LOOP
    extra := 0;
    FOR fk IN
      SELECT k.conrelid AS child, k.confrelid AS parent,
        (SELECT string_agg(format('c.%I=p.%I', ca.attname,pa.attname),
                           ' AND ' ORDER BY u.ord)
         FROM unnest(k.conkey,k.confkey)
              WITH ORDINALITY AS u(child_num,parent_num,ord)
         JOIN pg_attribute ca
           ON ca.attrelid=k.conrelid AND ca.attnum=u.child_num
         JOIN pg_attribute pa
           ON pa.attrelid=k.confrelid AND pa.attnum=u.parent_num
        ) AS predicate
      FROM pg_constraint k
      JOIN pg_class child ON child.oid=k.conrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace
      WHERE k.contype='f' AND ns.nspname='public'
        AND k.confrelid IN (SELECT DISTINCT relid FROM purge_rows)
    LOOP
      EXECUTE format(
        'INSERT INTO purge_rows
         SELECT %s::oid,c.ctid
         FROM %s c JOIN %s p ON %s
         JOIN purge_rows v ON v.relid=%s::oid AND v.row_tid=p.ctid
         ON CONFLICT DO NOTHING',
        fk.child, fk.child::regclass, fk.parent::regclass,
        fk.predicate, fk.parent
      );
      GET DIAGNOSTICS added = ROW_COUNT;
      extra := extra + added;
    END LOOP;
    EXIT WHEN extra=0;
  END LOOP;
  IF extra<>0 THEN RAISE EXCEPTION 'Dependency traversal incomplete'; END IF;

  -- The generic CRM event log uses resource IDs rather than foreign keys.
  INSERT INTO purge_rows
  SELECT 'enkyron_crm_events'::regclass::oid, e.ctid
  FROM enkyron_crm_events e
  WHERE e.workspace_key='local:emprex'
    AND ((e.resource_kind='company'
          AND e.resource_id='3b2a6e9a-8d53-4409-ad32-ab2d59398c1b')
      OR (e.resource_kind='contact' AND EXISTS (
         SELECT 1 FROM enkyron_crm_contacts c
         JOIN purge_rows v
           ON v.relid='enkyron_crm_contacts'::regclass::oid
          AND v.row_tid=c.ctid
         WHERE c.id=e.resource_id)))
  ON CONFLICT DO NOTHING;

  -- Never select another company, prospect or opportunity.
  IF EXISTS (
    SELECT 1 FROM enkyron_crm_companies c
    JOIN purge_rows v
      ON v.relid='enkyron_crm_companies'::regclass::oid AND v.row_tid=c.ctid
    WHERE c.id<>'3b2a6e9a-8d53-4409-ad32-ab2d59398c1b'
  ) OR EXISTS (
    SELECT 1 FROM enkyron_crm_opportunities o
    JOIN purge_rows v
      ON v.relid='enkyron_crm_opportunities'::regclass::oid AND v.row_tid=o.ctid
    WHERE o.id NOT IN (
      '7c03cdbf-dafe-47b0-b732-c8973b5a57ab',
      '88434ffe-a75f-450d-8fb9-923484ed3130')
  ) OR EXISTS (
    SELECT 1 FROM sales_prospects p
    JOIN purge_rows v
      ON v.relid='sales_prospects'::regclass::oid AND v.row_tid=p.ctid
    WHERE p.id<>'lead_2e6edc598df744e085f9c40cb6e1c85b'
  ) THEN
    RAISE EXCEPTION 'Protected commercial data would be affected';
  END IF;

  -- Preserve trigger modes, including previously disabled triggers.
  CREATE TEMP TABLE purge_restore_triggers ON COMMIT DROP AS
  SELECT DISTINCT t.tgrelid,t.tgname,t.tgenabled
  FROM pg_trigger t
  JOIN purge_rows v ON v.relid=t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgenabled<>'D';
  FOR saved IN SELECT * FROM purge_restore_triggers LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',
                   saved.tgrelid::regclass,saved.tgname);
  END LOOP;

  CREATE TEMP TABLE purge_pending ON COMMIT DROP AS
  SELECT DISTINCT relid FROM purge_rows;
  WHILE EXISTS (SELECT 1 FROM purge_pending) LOOP
    progressed := 0;
    FOR target IN SELECT relid FROM purge_pending ORDER BY relid LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE ctid IN
                        (SELECT row_tid FROM purge_rows WHERE relid=%s::oid)',
                       target.relid::regclass,target.relid);
        DELETE FROM purge_pending WHERE relid=target.relid;
        progressed := progressed + 1;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL; -- Try this table after its referring tables are removed.
      END;
    END LOOP;
    IF progressed=0 THEN
      RAISE EXCEPTION 'Dependent records cannot be deleted safely';
    END IF;
  END LOOP;

  FOR saved IN SELECT * FROM purge_restore_triggers LOOP
    EXECUTE format('ALTER TABLE %s ENABLE %s TRIGGER %I',
      saved.tgrelid::regclass,
      CASE saved.tgenabled WHEN 'A' THEN 'ALWAYS'
                          WHEN 'R' THEN 'REPLICA' ELSE '' END,
      saved.tgname);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM enkyron_crm_opportunities
    WHERE id IN ('7c03cdbf-dafe-47b0-b732-c8973b5a57ab',
                 '88434ffe-a75f-450d-8fb9-923484ed3130')
  ) OR EXISTS (
    SELECT 1 FROM enkyron_crm_companies
    WHERE id='3b2a6e9a-8d53-4409-ad32-ab2d59398c1b'
  ) OR EXISTS (
    SELECT 1 FROM sales_prospects
    WHERE id='lead_2e6edc598df744e085f9c40cb6e1c85b'
  ) THEN RAISE EXCEPTION 'Purge incomplete'; END IF;

  IF (SELECT count(*) FROM enkyron_crm_companies
      WHERE workspace_key='local:emprex'
        AND id IN ('3491ea38-c5f9-4f9b-8bf8-34ac31aa7661',
                   'f2059f56-4a25-4eaa-9cf4-eb5ecda60ba1',
                   '5b6de07c-0774-4e60-9a55-6e6457669156',
                   '49e800b6-3080-4cc7-bf89-007c432ddde1',
                   '49aa224b-9dff-4236-9f93-6faa79a70e02'))<>5
    OR (SELECT count(*) FROM enkyron_crm_opportunities
      WHERE workspace_key='local:emprex'
        AND id IN ('abb0616c-0c95-4f7e-9c3a-b49812f459aa',
                   '68e65606-1042-423a-8a69-b93a513cdc2d'))<>2 THEN
    RAISE EXCEPTION 'Protected records not intact';
  END IF;
  RAISE NOTICE 'Two named synthetic dossiers deleted; other companies retained';
END
$cleanup$;
COMMIT;
SQL
echo 'SUPPRESSION TERMINEE: ARL E2E Test 0711 + inference.sh'
