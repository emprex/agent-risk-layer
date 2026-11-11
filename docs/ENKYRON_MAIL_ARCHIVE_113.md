# ENKYRON Mail — E04-05 / E04-06A — PostgreSQL content archive

**Status:** IN-PROGRESS / GitHub branch `fix/enkyron-detached-windows-and-reply-20261111`.
**Authority:** `docs/ENKYRON_PSA_ROADMAP.md`, Bloc 04; this is a detailed implementation note, not a replacement roadmap.
**No automatic deployment:** Never apply schema 113 or touch production emails without the operator's explicit review. PostgreSQL `arl_local` is still the sole persistent archive; Resend is the transport.

## Existing architecture and scope

ENKYRON (native PySide6) → existing local Node bridge → NEMORYTH (`arl_local`).
Resend Inbox GET fetches messages using server-owned credentials and PostgreSQL mailbox read rights.
There is **no new database, daemon, service, webhook listener, remote exposure, or LLM authority**.

The historical `112_enkyron_local_mail_calendar.sql` migration is immutable and remains in use for threads, 20,000-character previews, labels, folders and calendar. The new `113_enkyron_mail_content_archive.sql` is **additive only**:

- `enkyron_mail_full_messages`: mailbox/thread/message IDs bound to existing rows; full inert plain text and HTML source (2 MiB limit each); sender/recipients, RFC Message-ID, SHA-256 and explicit `body_captured` or `incomplete` status.
- `enkyron_mail_attachment_quarantine`: one attachment metadata record per provider attachment ID, associated to the immutable mail reference. `metadata_only` means **the actual attachment bytes have NOT been archived**. The table reserves a `BYTEA` quarantine field with SHA-256, but no current path downloads, scans, releases, executes or exports those bytes. A later gated implementation must enforce the scanner, file-size, content-type, signed-URL and retention policies.
- Referential integrity prevents arbitrary attachment records or archived text without an existing local message. No cascading deletion from a provider event is enabled.

## Reference code and provider contracts

Functional reference consulted in the operator-provided `evolution-3.62.1.tar.xz`:

- `src/mail/e-mail-reader.c`: reader and message actions.
- `src/composer/e-msg-composer.c`: independent compose workflow.
- `src/e-util/e-attachment-store.c`: attachment storage and UI lifecycle.

This is a **functional comparison** only; no Evolution source code was copied or linked. Evolution uses a different GTK/Camel architecture and LGPL code must not be pasted into ENKYRON as if it were an internal implementation.

Provider source: Resend **Inboxes** (Oct 2026) exposes a GET endpoint for detailed emails in threads. This does not mean the old `emails/receiving/{id}/attachments` API has the same IDs or that Inbox attachments can safely be downloaded from arbitrary signed URLs. Do not invent an attachment-download mapping.

## Code behavior

1. The existing bounded Resend Inbox sync keeps working with schema 112 alone.
2. When 113 is applied and the operator has read permission, `mail-local-archive-sync` chooses at most four local messages missing archival data. Each is re-read by the trusted Resend Inbox message-detail GET and checked against the original mailbox/thread/message identity.
3. One PostgreSQL transaction stores inert text/HTML, sender/recipient provenance, SHA-256 and attachment *metadata* only. Retries use the existing message identity as the deduplication key; the operation never sends an email or changes the provider's folders.
4. A message longer than the old preview column can be staged in schema 112 with a clearly marked placeholder, then retrieved in full by the archive service. Before 113 exists, the old fail-closed behavior is retained (no silent truncation).
5. The Qt reading pane can show up to 20,000 characters of full archived plain text with an explicit preview notice. It never renders the archived HTML or offers quarantined attachments as downloads.
6. Errors stay per-message and preserve earlier previews. The operator can inspect metadata with `mail-archive-status`; missing/malformed provider information is not reported as a complete email archive.

- **E04-06B internal storage primitive (GitHub, not enabled for provider downloads):** `quarantineAttachmentBytes` can atomically save byte buffers that match a pre-existing attachment manifest and declared size, record SHA-256, and mark `quarantined_unscanned`. Rejects oversized, mismatched, cross-workspace, blocked and contradictory content. Repeat with an identical hash is idempotent. The primitive has **no IPC action and no attachment release path**. Provider discovery, secure signed-URL acquisition, content fetching and malware scanning have deliberately not been claimed as complete.

## Security, knowledge and retention boundary

- Emails are **untrusted customer input**, not EIRYON instructions, KYRTHOS findings or verified evidence.
- No attachment is automatically opened, scanned, indexed as trusted knowledge, or transferred to an agent.
- `body_captured` proves only a bounded provider body capture; it does not assert all attachment bytes were obtained or that the email is suitable for retention, disclosure or knowledge indexing.
- Before indexing into NEMORYTH knowledge, implement explicit data handling, provenance, tenant isolation, retention/deletion policy, injection-resilient retrieval and accountable operator approval.
- UK data protection/retention and the Resend processor relationship require separate review before external customer production use.

## Deployment and acceptance

**Never edit migrations 112 or prior.** Verify the exact Git commit, review the pending migration SQL and its checksum, and preserve untracked local files. The installer is `scripts/enkyron-mail-archive-schema.mjs` and supports:

- `--check`: PostgreSQL-only inspection, **no writes**.
- `--apply`: only after explicit operator approval; verifies the 112 checksum, creates owner-only `pg_dump`, validates backup with `pg_restore --list`, then executes 113 in one transaction. On error it rolls back.

Required CI: synthetic PostgreSQL schema 113; full 25,000-character body; two messages replayed without duplication; injection-like HTML stored inert; malformed identifiers rejected; metadata-only attachment not downloadable. Native Qt smoke tests ensure Inbox and Reply keep working without migration.

Required Debian acceptance: confirm `--check`, inspect backup policy, then approve `--apply` separately. Send a controlled message with a small benign attachment only after the attachment byte-capture and scanner gate are implemented. Do not delete the verified Gmail→Direction mail before acceptance.

## Explicit remaining gaps

- Verified Resend **Inboxes** attachment source / signed download mapping and content transfer, quarantine scanner and safe manual release. The separate Resend **Receiving Emails** attachment endpoints do **not** establish an equivalent Inbox message-ID contract; never substitute one identifier for the other.
- Complete display of very long messages (not only their 20k preview).
- Rich HTML sanitisation/viewer and remote-content blocking.
- Reply All, multirecipient compose, CC/BCC, signatures, full forward handling.
- Retention/deletion, backup and restore testing, audit schema for new actions.
- CRM/ticket linking only with explicit human review; no automatic AI classification.
