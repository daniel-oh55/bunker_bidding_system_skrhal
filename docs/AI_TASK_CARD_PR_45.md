# AI Task Card — PR #45

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `4a313e967752019c078ec1f0875e039a30d6eb13` (`feat: add default seller bid participation (#44)`)
- Working branch: `docs/pr-45-reconcile-default-seller-production-state`
- Target PR and expected HEAD: Draft PR #45; one focused documentation and exact-content migration-rename commit on the base above
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no open overlapping PR

## Current migration state

- Repository migrations: thirteen, ending before reconciliation with `20260828050000_default_seller_bid_participation.sql`; this PR renames that exact SQL to the Production-recorded `20260828085523_default_seller_bid_participation.sql`
- Local clean-replay status: not run because another project's active Supabase stack owns this repository's configured default ports; exact-head GitHub database validation must clean-replay all thirteen migrations and pass pgTAP
- Remote applied status: the approved Production project has all thirteen migrations applied; the final recorded version is `20260828085523_default_seller_bid_participation`

## Single purpose

Reconcile the PR #44 migration filename with its already-recorded Production version and update canonical documentation to the verified Production state, without changing SQL, application behavior, authorization, or Production.

## Protected business invariant

Repository migration history must identify the already-applied PR #44 SQL with the exact Production-recorded version while preserving its bytes. The rename must not create a second logical migration or alter the default-SELLER snapshot, explicit BID-scope authority, BUYER-only comparison RPC, append-only audit, lifecycle, or no-historical-backfill contracts.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| BUYER admin/operator | Existing active verified BUYER membership | Existing comparison behavior unchanged | Existing BID behavior unchanged | Existing behavior unchanged | Existing behavior unchanged | No authorization or UX contract change |
| TRADER | Existing active account, membership, organization, and explicit BID scope | Existing scoped BID/quote behavior unchanged | Existing own-quote behavior unchanged | Existing own-quote behavior unchanged | BUYER transitions remain denied | No authority broadened by documentation or rename |
| Anonymous, inactive, suspended, or forged caller | No valid active business context | Existing denials remain | Denied | Denied | Denied | No privilege change |
| Production operator | Owner-approved state is already applied | Read-only verification represented in docs | No new Production records | No Production mutation | No deployment or migration action | PR changes repository files only |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Migration identity reconciliation | Filename becomes the exact Production version; SQL remains byte-identical | Unchanged | Unchanged | N/A |
| Explicit SELLER BID scope | Existing database keys and status constraints unchanged | Existing private-table boundary unchanged | Existing `create_bid` snapshot contract unchanged | Existing presentation unchanged |
| BUYER comparison privilege | No schema or grant change | Existing private-table denial unchanged | Existing fixed-empty-search-path, authenticated-only RPC unchanged | `Awaiting quote` code is deployed; direct browser row smoke is not claimed |
| Audit and lifecycle preservation | Append-only history and normal cancellation remain authoritative | Unchanged | Existing `cancel_bid` recovery path documented | No change |

## Allowed files

Only `PROJECT_STATE.md`, `docs/PRODUCT_AND_SCOPE.md`, `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md`, this Task Card, and the exact-content migration rename from `supabase/migrations/20260828050000_default_seller_bid_participation.sql` to `supabase/migrations/20260828085523_default_seller_bid_participation.sql`.

## Forbidden scope

No SQL-content change, new migration, application or test edit, legacy edit, Production Supabase access or mutation, synthetic-history deletion, SELLER mutation, Auth, Gmail, Cron, Vault, secret, manual Vercel deployment, branch cleanup, Ready state, or merge.

## Database and migration plan

1. Rename only the PR #44 migration to `20260828085523_default_seller_bid_participation.sql`.
2. Prove the renamed file is byte-identical to the base blob and Git recognizes an exact-content rename.
3. Clean-replay all thirteen migrations locally when the Supabase stack is safe, then run the complete pgTAP suite.
4. Do not connect to or mutate Production.

## Test scenarios

- Positive, denial, and cross-organization cases: no behavior is implemented in this PR; the existing full frontend and pgTAP suites must continue to pass unchanged.
- Client-claim bypass, inactive/suspended, and privilege cases: existing PR #44 pgTAP coverage must remain green; documentation must retain explicit-scope authority, fixed empty search paths, authenticated comparison EXECUTE, and `anon`/`PUBLIC` denial.
- Concurrency cases where relevant: no concurrency logic changes; existing database concurrency coverage runs through the repository suite.
- Reconciliation proof: thirteen migrations replay in order, the old filename is absent, the new filename is present, and its blob bytes match the old base content.

## Production verification represented by this PR

- Before apply there were two BIDs, one BID-scope row, and two active SELLER organizations. Immediately after apply and before intentional smoke creation, the BID and scope counts remained two and one, proving no historical BID backfill.
- The applied functions exist with `SECURITY DEFINER` and fixed empty search paths. `authenticated` has comparison EXECUTE; `anon` and `PUBLIC` do not.
- The controlled backend smoke verified revision 1, two automatically inserted explicit SELLER scopes with the verified creating BUYER actor, one created audit whose scope snapshot matched, no automatic `trader_access_granted` audit, zero quotes, and two comparison rows with null quotes plus active access and organization flags.
- The intended one-BID smoke used composite expansion equivalent to `select (public.create_bid(...)).*;`. PostgreSQL evaluated the mutating 22-field composite-returning function once per field, creating 22 synthetic BIDs in the same second. This was a smoke invocation/query error, not a PR #44 product defect.
- Each synthetic BID correctly received two default scope rows. No direct delete or audit bypass was used: 21 unintended BIDs and the one retained temporarily for comparison were all cancelled through `public.cancel_bid`.
- Final synthetic state: 22 BIDs, 22 cancelled, zero open, 44 retained scope rows, zero quotes, 22 created audit events, and 22 cancelled audit events. The non-smoke state remained two BIDs and one scope row.
- The merged-main Vercel status reported a successful deployment. No direct browser-authenticated Production UI smoke of an `Awaiting quote` row is claimed.

## Validation commands

Run `npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; lint; typecheck; full Vitest; build; foundation check; `git diff --check`; and, when safe, db start/reset/test/stop. Exact-head GitHub validate and database-validation checks remain mandatory.

## Stop conditions

Stop for a moved base, dirty tree, overlapping PR, migration byte difference, unexpected file change, Production connection or mutation requirement, dependency hard-gate failure, unsafe conflict with another Supabase stack, migration-history mismatch, or any need to alter policy or application behavior.

## Git and PR rules

Prefer one commit `docs: reconcile default seller production state`; push only the named branch; open Draft PR #45 against `main`; never mark ready, merge, deploy, apply a migration, mutate Production, or clean branches.

## Completion report

Record preflight; start and final SHAs; branch and commit; exact files; old-to-new migration rename and byte/R100 proof; canonical Production corrections; exact smoke-incident wording; explicit no-browser-smoke claim; clean-replay count; pgTAP and frontend totals; audits and checks; exact-head GitHub checks; Vercel Preview; Draft PR URL/state; no Production mutation/deployment; and deviations.

## Recommended model and reasoning

Medium reasoning is appropriate because this PR changes only documentation and a byte-identical migration filename. The existing security policy and SQL are read-only context; any discovered need to change them is a stop condition.

## Owner approval point

No Production action is part of this PR. Human approval remains required for Ready state, merge, deployment, or any future Production mutation.
