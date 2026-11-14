# ENKYRON Professional Mail — Product and Acceptance Contract

**Owner:** AGENTRISKLAYER LTD · **Status:** in development / not commercially complete  
**Date:** 2026-11-14 · **Canonical delivery PR:** [#601](https://github.com/emprex/agent-risk-layer/pull/601)  
**Demand:** native, daily-use professional email within ENKYRON, comparable in practical workflow quality to Outlook and Evolution, integrated with Client Desk and CRM. This is **not** permission to copy proprietary UI or source.  
**Upstream product plan:** ENKYRON Plan Directeur ENK-06 / UAT-05, [Founder #602](https://github.com/emprex/agent-risk-layer/issues/602), [Mail workflow #565](https://github.com/emprex/agent-risk-layer/issues/565). Existing Mail PRs [#560](https://github.com/emprex/agent-risk-layer/pull/560), [#561](https://github.com/emprex/agent-risk-layer/pull/561) and [#562](https://github.com/emprex/agent-risk-layer/pull/562) are historical ancestors of #601 — **do not merge them again**.

## Product boundary — four pillars

- **ENKYRON:** one coherent Mail workspace and explicit actions; no terminal in daily work.
- **NEMORYTH:** authoritative local records, provenance, links, search, retention and immutable history.
- **EIRYON:** future suggestions only under delegated policy; never auto-send or infer client identity from incoming text.
- **KYRTHOS / ARL:** assessment evidence comes only from verified security workflows, never solely from email claims.

## User experience

Keep one main navigation entry **Mail**, not a duplicate CRM tab. Main layout: **left** mailboxes and folders, **centre** paginated/searchable conversations, **right** safe threaded reader. Empty areas may remain empty until real correspondence exists; no dummy customer messages. Maintain readable laptop widths, accessible keyboard focus and optional detachable Mail window. From either Mail, CRM or Ticket, show the *same* saved conversation reference, not three divergent copies. Standard customer operations should not require SQL/CLI.

## Feature register (status is deliberately conservative)

| Capability | Existing basis | Required acceptance or implementation |
|---|---|---|
| Two configured ARL mailboxes, Inbox/Sent/Drafts/Archive/Spam/Trash | Resend, local Mail workspace code | Verify distinct mailbox permissions and accurate provider state; no invented Inbox counts |
| Readable threaded conversations | Qt safe plain-text reader, local cache | Exact sender/reply-to/date provenance; no remote HTML, scripting or automatic external content |
| Search, paging, read/unread and flagging | Local PostgreSQL services | Search across sender, subject, body, label with 50-record paging, consistent filters and state preservation |
| Custom folders, move, rename, delete-empty, labels | Local folder and label services | Full GUI review, no provider folder mutation implied by local organization, no accidental message removal |
| New mail, Reply, Forward, Sent and local drafts | Code present, partial acceptance | Correct reply target, explicit send confirmation, durable draft, idempotent provider submission; transparent accepted/uncertain/failure outcome |
| **Reply All, multi-To, CC/BCC** | Not accepted as a complete workflow | Explicit recipient editor and dedupe, reply-to rules, no unauthorized recipients, safe draft persistence and provider idempotency |
| Per-mailbox signatures, reusable templates | Not accepted as complete | Human-editable, explicit insertion, no auto-send, plain-text fallback |
| Attachments received and outbound | Archive/quarantine groundwork | Provider attachment ID and real bytes, strict size/type limits, malware/unsafe content handling, verified quarantine and release; never present metadata as downloaded bytes |
| Mail ↔ existing CRM company | Explicit local link code | Human-reviewed identity, scoped read/write, eventual correction audit without rewriting source |
| **Mail ↔ existing Client Desk Ticket** | E04-04B code + schema 116 proposed | Manual exact ticket selection + reason, immutable linkage, cross-company denial, bidirectional readback and real Debian UAT; **migration not approved/applied** |
| Mail ↔ contact or opportunity | Not complete | Explicit matching and review, no identity inference from email domain |
| Mail ↔ Calendar/task/follow-up | Separate Calendar and CRM services | Operator-approved reminders from correspondence; no invitation or task created just by reading email |
| Professional organization | Mixed | Saved filters, safe bulk actions, conversation triage, keyboard navigation, accessibility, export/backup/recovery and notifications progressively |
| Mail account/transport health | Resend connection/status | Clear auth/error/offline state, retry of *reads*, no blind retry after ambiguous send |
| Security/privacy | Local-only OS owner scope today | Protected provider secrets, no message-driven commands, audit/trust boundaries, retention controls and policy review |

**No implicit claim of feature completeness.** A function present in code or a green CI is not equivalent to a completed Debian operator acceptance.

## Incremental delivery and exit gates

1. **E04-04B — Mail ↔ Ticket:** backend/Qt route and isolated PostgreSQL integration tested on PR #601. Installable schema 116 exists as a *proposed* additive DDL. Guarded checker/installer: `scripts/enkyron-mail-ticket-links-schema.mjs`. **No `arl_local` apply without separate explicit owner approval**, verified backup, checksum preflight, then real Debian GUI readback using approved existing records. Never recreate UAT-04, real customer ticket or old NEMORYTH audit.
2. **Professional composition:** evaluate current compose and draft model. Deliver To, CC, BCC, Reply All, signatures and templates in small, separately tested steps. Provider send must remain a human-confirmed, idempotent operation with honest outcome state.
3. **Secure attachments:** provenance → quarantine → validated inspection → explicit safe access, then reviewed outbound attachment delivery. Avoid active/remote HTML content and credential disclosure.
4. **Workflow integration:** explicit company/contact/opportunity/ticket links, activity and calendar follow-up readback. Then advanced folder tools and productivity features.

For every increment: **domain tests → bridge contract → Qt headless → disposable PostgreSQL → exact-head CI → Debian visual/business UAT**. Preserve existing real data, the historical `~/agent-risk-layer` repository, all ARL evidence, and `~/enkyron-release-candidate` until guarded update is requested. No reset, rebase, merge, migration or unsolicited real email.

## Deferred architecture: users and database authorization

The founder has explicitly postponed multiuser support until the **user cards, roles and database permission model** are designed. Current `local:<OS user>` isolation and `organization_owner_l5` mailbox row are **not** proof of authenticated multiuser RBAC. Do not add pretend user roles or claim cross-tenant isolation. Future UAT-08 and UAT-09 will require two real test identities, backend access denial, workspace/organization scoping, auditable delegation and careful migration of existing source records.

## Operational business priority

The completion target is a reliable, usable **daily Mail client** that can receive/reply/organize, locate correspondence for a client or ticket and prepare business follow-ups, without false claims about security assessment, customer consent, delivery, invoicing or permissions. Prioritize work that directly lets AGENTRISKLAYER LTD serve and bill real customers.
