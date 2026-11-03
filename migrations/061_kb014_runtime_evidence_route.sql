-- 061: KB-014 explicit runtime positive/negative evidence routing.
-- Additive canonical candidate correction only. Historical frozen assessments,
-- test executions, evidence, human decisions, master revisions and ROE remain untouched.
-- Routing is NOT an executable adapter, security finding, PASS or FAIL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM risk_knowledge_entries
    WHERE id='ARL-KB-014' AND content_digest='37d4568c5b8066eb244d3981ef94793544b0ecf18fbb8c24549054de4481b8aa'
  ) OR NOT EXISTS (
    SELECT 1 FROM risk_knowledge_checks
    WHERE entry_id='ARL-KB-014' AND content_digest='9f55fdb91cf5d4543569eed6a3f920b11804153c3440685a6fbf51eac45bf361'
  ) THEN
    RAISE EXCEPTION 'KB-014 migration 061: canonical baseline digest mismatch';
  END IF;
END
$$;

UPDATE risk_knowledge_entries
SET content_digest='59ae778a119d0eb19b3ca2110b163e0f5b320b07518c98cb75a4a646bc5d2f5e', updated_at='2026-11-03'
WHERE id='ARL-KB-014' AND content_digest='37d4568c5b8066eb244d3981ef94793544b0ecf18fbb8c24549054de4481b8aa';

UPDATE risk_knowledge_checks
SET required_evidence_json='["ARL-KB-014 assessed system, exact version, environment and credential scope","Authoritative credential or workload-identity inventory with owner, purpose, scope and lifecycle state","Secret-store, environment, CI/CD and runtime references showing which credentials the assessed version can use","Evidence of expiry, rotation, revocation or short-lived issuance where applicable","ARL-KB-014 observed runtime positive and bounded negative test evidence using owner-authorised synthetic approved, revoked and orphan credential references, with receiving-side authorization decisions, correlated downstream effects or denial, exact assessed version and test scope","Tester identity, timestamp and evidence digest"]',
    content_digest='765bf3fd5de0036a7f00f04dae59c42a517dd6d0b619f01424198c9fdf4083f8',
    updated_at='2026-11-03'
WHERE entry_id='ARL-KB-014' AND content_digest='9f55fdb91cf5d4543569eed6a3f920b11804153c3440685a6fbf51eac45bf361';
