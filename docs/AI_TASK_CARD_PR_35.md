# AI Task Card — PR #35 Gmail Mailbox Connector Foundation

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `origin/main` at `0177fef859c09ba1bfad28f162ba5448dd1c8ca8`
- Working branch: `feat/pr-35-gmail-mailbox-connector-foundation`
- Target PR and expected HEAD: Draft PR #35; reviewed implementation head `f729eac7defba8674bbdea9857e1d90e9e1c6430` plus exactly one correction commit
- Working tree status: correction continuation pre-flight (2026-08-24): `HEAD` is the reviewed implementation head and the tree is clean; no merge, rebase, cherry-pick, or revert is in progress.

## Current migration state

- Repository migrations: nine immutable migrations through `20260821100000_mail_intake_ingress_hardening.sql` at the starting SHA; this PR adds one CLI-generated forward migration.
- Local clean-replay status: passed on 2026-08-24 using owner-authorized temporary alternate validation ports with nonessential local log services excluded; all migrations, 475 pgTAP assertions, concurrency/integration suites, and synthetic Edge validation passed. The alternate stack was stopped and `supabase/config.toml` was restored byte-for-byte before handoff.
- Remote applied status: unknown and deliberately not inferred because no remote Supabase project is linked.

## Single purpose

Add the provider-specific, server-only foundation that discovers new Gmail INBOX messages after an explicit cutover cursor, extracts bounded inline plain text, reuses the existing advisory bunker parser, and calls the existing ingest-only mail intake RPC without accessing a real mailbox or Production system.

## Protected business invariant

Only a request carrying the dedicated connector trigger secret may cause the server function to use the configured read-only Gmail OAuth grant and backend Supabase credential. The configured Gmail profile must match exactly. A first run establishes a no-history-import cutover. Later runs ingest only fully fetched, normalized candidates discovered from the saved history cursor, and the cursor advances exactly once only after the full batch succeeds, except that a definitive `users.messages.get` HTTP 404 for an already history-discovered message is terminal absence and may be counted without revealing its identity. No actor may use this connector to read queue rows, mutate queue lifecycle, create bids, derive commercial authority, store message/address/credential data, or bypass cursor CAS.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Authorized connector invocation | POST with exact trigger secret and valid server configuration; Gmail profile matches | Gmail profile/history/full messages; cursor metadata through RPC | Normalized intake through existing ingest RPC; initial cursor through CAS RPC | Cursor through expected revision only | None | Fixed aggregate success; cursor advances after the complete batch |
| First authorized invocation | No cursor exists and profile matches | Gmail profile only; cursor absence | Current profile history ID as cutover cursor | None | None | Zero historical messages ingested |
| Missing/wrong trigger, browser JWT, or non-POST caller | Connector authority absent | None | None | None | None | Fixed rejection before OAuth, Gmail, Supabase, or cursor work |
| `anon` / `authenticated` | Any client claim or membership | No cursor table/RPC access | None | None | None | Database permission denial |
| Backend database role outside cursor RPC | Direct-table attempt | None | None | None | None | Direct cursor-table CRUD denied; existing queue privilege split unchanged |
| Concurrent connector with stale revision | Another run initialized or advanced first | Current cursor only on a later invocation | None | No stale overwrite | None | SQLSTATE `40001` / fixed cursor-conflict result |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Bounded provider-neutral cursor identity | Provider, opaque mailbox key, cursor, and revision checks | Enabled with no policies | Fixed-search-path get/CAS RPCs validate all inputs | No browser surface |
| Cursor access is connector-only | Primary key and non-secret columns only | Defense in depth | Execute granted only to backend role; direct table privileges revoked | No browser surface |
| Gmail is readonly and account-bound | Server configuration validation | N/A | Refresh exchange requests only `gmail.readonly`, validates the returned scope set is exactly `gmail.readonly`, and compares the profile email exactly | No browser surface |
| No historical import or silent recovery | Cursor represents explicit cutover | N/A | First run initializes only; stale history fails closed; only a history-discovered message GET 404 is terminal absence | Fixed aggregate operational result with no message identity |
| Normalized advisory ingress only | Existing queue constraints and source identity uniqueness | Existing private queue boundary | Existing ingest-only RPC; serialization failures have a bounded retry | Existing BUYER/TRADER behavior unchanged |
| Raw/HTML/attachment/address exclusion | No storage columns for those values | Existing private queue boundary | Inline `text/plain` only with total decoded cap; no attachment endpoint | No browser surface |

## Allowed files

- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_35.md`
- `supabase/config.toml`
- One CLI-generated migration under `supabase/migrations/`
- Focused files under `supabase/tests/database/`
- Focused connector code/tests/config under `supabase/functions/`
- `scripts/check-foundation-boundaries.mjs` and its focused tests
- Narrow CI or test-script configuration only when required to hard-gate Edge Function validation
- `src/bidding/bid-intake.ts` solely to remove its local type import so the existing canonical parser can be bundled by Deno; `src/bidding/bid-intake.test.ts` only for focused regression coverage if necessary

## Forbidden scope

No frontend behavior, bid/quote/award RPC, Realtime, browser Auth, `CreateBidForm`, PR #34 queue behavior, queue direct CRUD/list/dismiss authority for the connector, IMAP, broader Gmail scope, raw format, HTML parsing, attachment fetch, address extraction, URL following, real fixture/data/account, secret value, Google OAuth setup (which remains a later owner-controlled Production step), remote link, deploy, Production config/migration, cron, automatic historical recovery, dependency expansion, or duplicated business parser.

## Database and migration plan

Create one provider-neutral private cursor table containing only provider, opaque mailbox key, opaque cursor, revision, and timestamps. Enable RLS with no policies and revoke direct access from all API/database roles including the backend connector role. Add only fixed-search-path `SECURITY DEFINER` read and compare-and-swap RPCs, revoke default execute, grant execute only to the backend role, and test validation, privileges, initialization, advancement, and stale-revision denial. Preserve all queue grants and contracts unchanged.

## Test scenarios

- Positive, denial, and cross-organization cases: trigger rejection before side effects; configuration validation; exact Gmail profile; first-run cutover; history pagination/filtering/deduplication and final-page history ID persistence; full-format fetch; terminal message GET 404 skip without identifier disclosure; non-404 message failure no-advance; Unicode-safe bounded Subject normalization; inline plain-text extraction and cap; exact normalized ingest mapping; full-batch cursor advance; private cursor privileges; existing queue privilege regression.
- Client-claim bypass, inactive/suspended, and privilege cases: user JWT is never authority; no client credential path; `anon` and `authenticated` cannot execute cursor RPCs; backend role cannot directly CRUD cursor or gain queue list/dismiss authority; errors/logs never contain credentials or mail contents.
- Concurrency cases where relevant: duplicate message ingest remains idempotent; ingest SQLSTATE `40001` retries only a small bounded number; stale cursor revisions fail with `40001`; all message/ingest failures except definitive history-discovered message GET 404 and stale Gmail history never advance/reset the cursor.

## Validation commands

Inspect pinned CLI help first. Run `npm ci`; all three required audit commands; lint; app/Node typecheck; all Vitest and focused Edge Function tests; build; foundation checker; clean local database replay; full pgTAP; all existing concurrency/integration suites; new cursor concurrency coverage; pinned-CLI Edge bundle/local validation; `git diff --check`; status; and allowlist diff. Verify exact-head CI and any generated Vercel check after pushing.

## Stop conditions

Stop for a dirty tree, base or migration-history mismatch, conflicting PR, required broader Gmail scope, IMAP/raw/HTML/attachment persistence, real credential/data/Production requirement, parser duplication, browser elevated credential, automatic historical import/recovery, unrelated dependency/architecture, or conflict with a canonical contract.

## Git and PR rules

Create exactly one correction commit titled `fix: harden gmail connector intake resilience`, push only the existing feature branch, and retain Draft PR #35 against `main`. Do not mark ready, merge, deploy, apply a Production migration, register secrets, configure Google OAuth or cron, access real Gmail, or start another PR.

## Completion report

Record repository/branch; starting and final HEAD; exact files and generated migration; cursor/RPC privilege contract; OAuth scope; trigger boundary; history/cutover/extraction behavior; exclusions; ingest mapping; retry/stale/CAS behavior; absence of secrets; checker delta; Edge/DB/full tests; audits and build checks; exact-head CI/Vercel; Draft PR; and deviations.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning was requested because this change introduces a server credential boundary, `SECURITY DEFINER` RPCs, and cursor concurrency semantics.

## Owner approval point

The Draft PR is the handoff boundary. Human approval is required before readiness, merge, any remote migration/function deployment, secret registration, Google OAuth configuration, cron setup, or real mailbox access.
