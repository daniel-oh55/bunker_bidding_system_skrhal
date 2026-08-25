# AI Task Card — PR #36

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `edd3060b9024a24ab961425c65f629be7b615bee`
- Working branch: `feat/pr-36-gmail-imap-app-password-connector`
- Target PR and expected HEAD: Draft PR #36; final implementation commit pending
- Working tree status: clean before this task card

## Current migration state

- Repository migrations: unchanged; the existing connector cursor migration remains authoritative.
- Local clean-replay status: pending local validation.
- Remote applied status: not inferred; no remote project is linked or changed.

## Single purpose

Replace the undeployed Gmail API/OAuth mail transport with a server-only Gmail IMAP-over-TLS App Password connector, preserving the normalized mail-intake queue, parser, trigger, and cursor-CAS contracts.

### Focused correction scope

Harden the already-reviewed connector without changing its transport or ingestion behavior: explicitly disable ImapFlow logging and automatic IDLE, restrict generated-state scanning exclusion to `supabase/.temp`, and restore bounded `40001` ingest retry coverage.

Correct the narrowly scoped ImapFlow single-part BODYSTRUCTURE shape: an eligible root `text/plain` node with an absent `part` maps to fixed IMAP part `"1"`; malformed eligible non-root nodes remain hard failures. Root HTML and attachment/filename-bearing plaintext remain excluded from download.

## Protected business invariant

Only a caller holding the server trigger secret may run a short-lived, read-only Gmail INBOX intake. It may persist only normalized advisory candidates through the existing authoritative ingest RPC and may advance the opaque cursor exactly once after a complete bounded snapshot. Browser users receive neither mailbox credentials nor mail content.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Unauthenticated caller | Missing/wrong trigger secret | None | None | None | None | Fixed 401; no IMAP or RPC work |
| Authorized connector | Valid trigger and server config | Read-only INBOX snapshot; cursor RPC | Normalized queue item through ingest RPC | CAS cursor only | None | Fixed aggregate response |
| Browser BUYER | Existing active membership | Existing normalized list RPC | None | Existing dismiss RPC | Pending → dismissed only | Unchanged behavior |
| Gmail mailbox | App Password supplied server-side | IMAP TLS 993, INBOX, read-only | None | None | None | Never mutates flags, mail, or folders |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Queue identity and normalized persistence | Existing unique identity | Existing private queue controls | Existing ingest RPC | Existing list/dismiss UI unchanged |
| Cursor ownership and CAS | Existing cursor schema | Existing private cursor controls | Existing get/CAS cursor RPCs | None |
| Connector invocation | N/A | N/A | Constant-time trigger check before all privileged work | No browser connector UI |
| Mailbox safety | N/A | N/A | Fixed IMAP host/TLS/INBOX/read-only adapter | None |

## Allowed files

Only the user-authorized connector, focused tests, canonical documentation, this task card, and exact IMAP dependency configuration if runtime validation requires it.

## Forbidden scope

No migrations, deployments, real credentials, Gmail access, cron, OAuth fallback, frontend mail UX, bid creation, authorization changes, or edits to `legacy/firebase-prototype/`.

## Database and migration plan

No database change. Reuse the existing `cursor_value` with strict `imap-v1:<uidvalidity>:<last_uid>` parsing and the existing cursor/ingest RPCs.

## Test scenarios

- Trigger denial and missing IMAP configuration fail closed before IMAP/RPC work.
- First run, empty inbox, no-new-mail, bounded snapshot, ordering, identity, UIDVALIDITY mismatch, and CAS conflict.
- Definitive absence advances only after other successful ingest; IMAP/body/ingest failures do not advance.
- Read-only behavior, MIME selection, 256 KiB aggregate cap, Unicode subjects including lone low surrogate, and INTERNALDATE authority.
- Single-part root plaintext with no `part` downloads only fixed part `"1"`, reaches normalized ingest once, and advances the captured cursor once; root HTML and root attachment/filename plaintext with no `part` do not download or hard-fail.
- ImapFlow construction fixes protocol logging off and automatic IDLE off without exposing credentials through the fixed-options contract.
- Only `supabase/.temp` is excluded from foundation scanning; `src/.temp` remains scanned for synthetic elevated credential values.
- A serialized ingest succeeds after two `40001` responses and fails after three without advancing the cursor.

## Validation commands

Run focused Edge tests and all repository-required audit, app, foundation, local database, integration, and concurrency checks where tooling/environment permits; prove Deno and local Edge bundle compatibility for the exact pinned IMAP dependency.

## Stop conditions

Stop for base SHA movement, overlapping PR, runtime incompatibility requiring broad hacks, migration need, credential exposure, or blocking dependency vulnerability.

## Git and PR rules

One implementation commit where possible; push only this branch and open a Draft PR. Do not deploy, merge, or mark ready.

## Completion report

Record base/final HEAD, changed files, pinned dependency and Edge proof, all validations/audits/CI, and confirmation that no migration, production, Gmail, cron, or secret action occurred.

## Recommended model and reasoning

Security-sensitive connector/auth/cursor work: high reasoning with independent review required by repository policy.

## Owner approval point

Any production action, remote project link, secret registration, Gmail account access, migration change, or incompatible runtime architecture requires owner approval.
