# ENK-08 — Mission Board native GUI preview (review required)

**Base:** `fe13d36b6cc0449446f4e5b87aaaf05a3c65d934` · **Scope:** UI only.

## User-visible change

- ENKYRON's existing left navigation gains **Projects** after Calendar. The home page gains a Projects shortcut; no second app is introduced.
- Opening Projects displays `MissionBoardView` inside the existing stacked Qt window.
- The default state is an explicit **NOT CONNECTED** empty state. `Explore example` loads two fictional, bounded mission dossiers, including tasks/milestones, due dates and progress.
- Search by company/mission, choose a dossier, inspect work items and completion percentage, then close the example.
- `New mission`, `Add work item`, and `Complete task` are deliberately disabled and clearly labelled. The Time Tracking area is labelled not enabled. No live PostgreSQL read/write, bridge call, external send or assessment action is added.
- Client titles/descriptions are displayed as plain Qt text, never HTML/Markdown. The presentation model checks canonical UUIDs, parent task bindings, status allowlists and length limits. This is not an authentication or backend authorization layer.

## Files

- `desktop/enkyron_mission_board_model.py` — pure presentation/data-boundary helpers and fictional fixtures.
- `desktop/enkyron_mission_board.py` — native PySide6 view.
- `desktop/enkyron.py` — bounded import, navigation, page creation and switch only. No unrelated refactor.
- `desktop/test_enkyron_mission_board_model.py` — 8 Python model tests.
- `desktop/test_enkyron_mission_board_qt.py` — 3 Qt widget smoke tests (skipped without PySide6).
- `desktop/test_enkyron_mission_board_wiring.py` — no-Qt wiring/static safety checks.

## Debian acceptance

On the exact reviewed feature branch:

```bash
cd ~/agent-risk-layer
python3 -m py_compile desktop/enkyron.py desktop/enkyron_mission_board.py desktop/enkyron_mission_board_model.py
python3 -m unittest discover -s desktop -p 'test_enkyron_mission_board_*.py' -v
```

Start ENKYRON using the existing shortcut/application launcher (do not start a second ARL service). Check Home → Projects and navigation → Projects, Explore example, filtering, selection, 2/5 progress, empty state, disabled buttons and legibility at 920×620 and 1360×840. Existing Tickets/CRM/Mail/Calendar must still navigate normally. The native app requires PySide6 installed locally.

## Release STOP

Previous **22** Node contract/mock tests and the extended **15**-test guarded PostgreSQL run passed on Debian. These results support planning + work item persistence on synthetic fixtures only, not product acceptance.

The full ENK-08 milestone is **not complete**:
1. The historical migration preflight is STOP. SQL drafts 118 and 119 are intentionally outside auto-discovered migrations. No migration or data change to `arl_local` is authorised.
2. Current local OS actor scoping is not verified multi-user RBAC. Before write-enabled GUI, integrate server/bridge-side authorisation with a verified principal and dedicated operation permissions.
3. Approval/contract/SOW gate (ENK-07), assignment/My Work, Time Tracking, deliverables, closing a real project, cross-organization isolation and recovery acceptance remain unimplemented/unverified.
4. A screenshot and human Debian GUI inspection are needed; syntax and static tests alone do not establish native usability.

This preview is a **UI demonstration**, not an accepted customer mission or an ARL security verdict.
