# AI Task Card — PR #47

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `e139d946faf3559aec7306a0b4c8af2f4ea6fba0`
- Working branch: `feat/pr-47-bid-operational-date`
- Target PR and expected HEAD: Draft PR #47; one focused implementation commit is preferred
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no open overlapping PR

## Current migration state

- Repository migrations: thirteen baseline migrations through `20260828085523_default_seller_bid_participation.sql`; this PR adds `20260831050000_bid_operational_date.sql`
- Local clean-replay status: passed through all fourteen migrations; 11 pgTAP files / 653 assertions passed. A separate local upgrade replay stopped at `20260828085523`, created a legacy BID with retained scope, quote, and created audit, then applied only `20260831050000`: Seoul backfill was correct and revision, status, creator, responsibility, `updated_at`, lifecycle timestamps, award fields, audit/scope/quote counts, and historical audit JSON all remained identical.
- Remote applied status: the baseline through PR #44 is documented as Production-applied; the PR #47 migration is repository-only and must not be remotely applied in this task

## Single purpose

Add a server-authoritative Asia/Seoul operational date to BIDs, scope BUYER listing and mail presentation to a selected operational date, and enforce current-Seoul-date-only BID/quote access for SELLER/TRADER users.

## Protected business invariant

`app_private.bids.bid_date` is the immutable Seoul calendar date at BID creation. PostgreSQL clock time is the only creation authority. BUYER-selected dates may narrow reads but never set or mutate BID dates. A TRADER may list a BID or its own quote, or create/update a quote, only when the BID date equals the server's current Seoul date; historical scope, quote, award, and audit rows remain retained.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER admin/operator | Server-verified active BUYER membership | Any explicitly selected BID date with existing all/my/responsible filters; all BUYER quote/audit history | BID only with server-derived current Seoul date | Existing lifecycle-authorized fields, never `bid_date` | Existing lifecycle transitions | Allowed; selected date is a required read scope, not an authorization boundary |
| Active TRADER | Server-verified active TRADER membership and explicit current BID scope | Current-Seoul-date BIDs and own current-date quotes only | One quote on a current-date effective-open BID | Own current-date effective-open quote only | None | Allowed only for current server Seoul date |
| Active TRADER with historical/future BID scope | Same membership and retained explicit scope | No BID or own quote through TRADER list RPCs | No quote | No quote update | None | Lifecycle-style server rejection; retained rows are not deleted |
| Inactive/suspended/anonymous/forged actor | Missing valid server membership context | None | None | None | None | Fail closed using existing authorization rules and narrow EXECUTE grants |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BID date exists and is immutable | `date not null`, private clock default, reject trigger | Private tables remain inaccessible | No BID mutation parameter exposes date | Exact `YYYY-MM-DD` parsing; no create payload date |
| BUYER date-scoped listing | — | Private tables remain inaccessible | Required non-null date plus existing view checks | One retained Operational date control |
| TRADER today-only visibility | — | Private tables remain inaccessible | `list_trader_bids` and `list_my_quotes` compare with private current date | No date selector; reload at Seoul rollover |
| TRADER today-only quote mutation | — | Private tables remain inaccessible | Locked target BID date checked in create/update quote RPCs | Stale UI is advisory only; server rejection remains final |
| Mail classification | — | Existing mail RPC unchanged | Existing authoritative `received_at` unchanged | Filter pending items by selected Seoul received date |

## Allowed files

- `supabase/migrations/20260831050000_bid_operational_date.sql`
- `supabase/tests/database/10_bid_operational_date.sql` and strictly necessary fixture adaptations
- Relevant files under `src/bidding/`, focused tests, and minimal `src/styles.css`
- `docs/AI_TASK_CARD_PR_47.md`, `PROJECT_STATE.md`, `docs/PRODUCT_AND_SCOPE.md`, `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md`

## Forbidden scope

No deploy, Production migration/data mutation, Gmail/Cron/Vault/secret changes, mail reparse/rescan/cursor change, quantity parser changes, legacy Firebase changes, historical row deletion, unrelated redesign, Ready state, or merge.

## Database and migration plan

Create private `current_bid_date()` from `clock_timestamp() AT TIME ZONE 'Asia/Seoul'`; add and backfill `bid_date` from each existing `created_at` without lifecycle/audit/revision/history changes; set the private default and `NOT NULL`; add a date-list index and immutability trigger; append the field to the BID result composite and current snapshot/result functions; replace the BUYER list signature; add current-date filters to TRADER lists; add locked current-date checks to quote mutations; revoke obsolete/public privileges and grant only the new authenticated RPC signature.

## Test scenarios

- Positive, denial, and cross-organization cases: admin/operator creation, active-SELLER default scope, exact date/view combinations, current-date TRADER visibility and quote create/update, historical retention, anonymous denial.
- Client-claim bypass, inactive/suspended, and privilege cases: null/invalid list date, direct BID-date update, obsolete signature absence, private helper denial, narrow authenticated execution.
- Concurrency cases where relevant: existing BID and quote concurrency gates must pass; the new immutable date has no client-controlled or compare-and-swap path.

## Validation commands

Run the complete repository-required npm audit/lint/typecheck/test/build/foundation/diff checks, local clean database replay and pgTAP, all CI integration/concurrency scripts, then exact-head GitHub `validate` and `database-validation` plus Vercel Preview.

## Stop conditions

Stop for a dirty preflight tree, base SHA mismatch, overlapping PR, migration-history mismatch, unexpected Production dependency, destructive historical behavior, or conflict with an existing lifecycle/authorization contract.

## Git and PR rules

Use only `feat/pr-47-bid-operational-date`, prefer commit `feat: add operational bid dates`, push it, and open Draft PR #47 against `main`. Do not deploy, mark Ready, or merge.

## Completion report

Record the requested 23-part evidence including exact SHAs/files, schema and backfill proof, behavior/tests/audits/checks, exact-head CI and Vercel, Draft URL/state, and confirmation of no Production mutation.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning; security-sensitive SQL receives an independent review using the repository review template.

## Owner approval point

Owner approval is required after merge before applying `20260831050000_bid_operational_date.sql` to Production. Deployment, Production migration, Ready state, and merge are outside this task.
