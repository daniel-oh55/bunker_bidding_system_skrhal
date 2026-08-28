# AI Task Card: PR #43 SELLER-admin migration-history reconciliation

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `e1ec4b3f65d2dfa3c4340b71ffac9a5477de0af2` (`feat: add seller master management (#42)`)
- Working branch: `chore/pr-43-reconcile-seller-admin-migration`
- Target PR and expected HEAD: Draft PR #43; preferably one documentation/reconciliation commit on the working branch
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no open PR

## Current migration state

- Repository migrations: twelve migrations at the base, with the SELLER-admin SQL stored as `20260827090000_trader_organization_admin.sql`
- Local clean-replay status: passed in an isolated temporary Supabase project on alternate ports without touching the already-running stack; all 12 migrations replayed and all 550 pgTAP assertions passed across 9 files
- Remote applied status: independently verified before this PR as twelve applied migrations; Production recorded the already-applied SELLER-admin migration as `20260828005713_trader_organization_admin`, while the repository used `20260827090000_trader_organization_admin`

## Single purpose

Reconcile the repository migration filename and canonical Production-state documentation with the already-applied Production SELLER-admin migration. Rename the existing migration to Production's recorded version without changing a byte of SQL and without changing application behavior, database behavior, authorization, or Production state.

## Protected business invariant

The already-applied Production SELLER-admin schema must correspond to exactly one repository migration whose version is `20260828005713_trader_organization_admin`, and that migration's SQL body must remain byte-for-byte identical to the PR #42 migration at base. No actor receives new read or mutation authority, no organization boundary changes, and no database or application rule is reimplemented.

Data ownership and organization boundary remain unchanged: SELLER is still the user-facing name for the existing TRADER organization identity, and every existing server-verified BUYER-admin, BUYER-operator, TRADER, inactive/suspended, anonymous, and forged-context rule remains authoritative exactly as implemented by PR #42.

Stop and recovery behavior: stop without attempting a workaround if SQL would need modification, a second or compensating migration would be necessary, Production migration history would need editing, an additional file would be required, clean replay would fail, or a dependency hard gate would fail. No Production rollback, repair, link, or mutation is permitted.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Existing authorized application actors | Existing PR #42 server-verified conditions | Unchanged | Unchanged | Unchanged | Unchanged | No functional or authorization change |
| Codex in this PR | Verified base, clean tree, no open PR | Repository and supplied verified facts only | Documentation task card only | Two canonical status documents | Rename one migration path only | No SQL-body or Production mutation |
| Any Production caller/operator | Any condition | No new read | No create | No history edit | No migration apply/rollback or SELLER mutation | Outside scope and denied by the PR contract |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Migration identity reconciliation | Exactly one repository file at `20260828005713_trader_organization_admin.sql`; Git detects a 100% rename | Unchanged | Unchanged | Unchanged |
| SQL byte identity | Base blob/hash equals renamed-file blob/hash | Unchanged | No function body changes | No application changes |
| Production safety | No Production call, migration apply, history edit, or data mutation | Unchanged | Unchanged | Documentation status only |
| Existing SELLER authorization | Existing PR #42 constraints remain authoritative | Unchanged | Existing RPCs unchanged | Existing BUYER-admin presentation unchanged |

## Allowed files

1. Rename `supabase/migrations/20260827090000_trader_organization_admin.sql` to `supabase/migrations/20260828005713_trader_organization_admin.sql`
2. `PROJECT_STATE.md`
3. `docs/PRODUCT_AND_SCOPE.md`
4. `docs/AI_TASK_CARD_PR_43.md`

## Forbidden scope

No SQL-body, functional, frontend, test, authorization, Supabase configuration, Vercel configuration, Gmail, mail-intake, Cron, Vault, secret, Auth, account, membership, SELLER data, BID data, or Production changes. Do not add a second or compensating migration; edit Production migration history; apply, roll back, or repair a migration; create/deactivate a SELLER; add default SELLER BID participation or automatic scope; add unquoted/Awaiting quote rows; backfill historical BIDs; or implement invitation, login, provisioning, rename, reactivation, or generic status administration.

## Database and migration plan

Use `git mv` to rename `supabase/migrations/20260827090000_trader_organization_admin.sql` to `supabase/migrations/20260828005713_trader_organization_admin.sql`. Preserve the SQL byte-for-byte. Verify the old path is absent, the new path exists, the base and working-tree blob/SHA-256 hashes match, and Git reports a 100% rename with no SQL line changes. Do not connect to or call Production and do not apply any migration outside a safe local clean replay.

## Test scenarios

- Positive, denial, and cross-organization cases: existing PR #42 pgTAP and frontend suites must continue to pass unchanged; no new behavior is introduced.
- Client-claim bypass, inactive/suspended, and privilege cases: existing denial tests remain unchanged and must pass in the full suites.
- Concurrency cases where relevant: existing SELLER-name uniqueness and deactivation concurrency coverage remains unchanged; this rename adds no concurrency logic.
- Reconciliation cases: old path absent, new path present, base/current SQL hashes identical, one migration file only, and Git rename similarity exactly 100%.

## Validation commands

Run `npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; `npm run lint`; `npm run typecheck`; `npm run test -- --run`; `npm run build`; `npm run check:foundation`; and `git diff --check`. Verify the migration paths, hashes, and `git diff --no-ext-diff --find-renames=100% origin/main...HEAD -- supabase/migrations/`. If safely available without interfering with another stack, run `npm run db:start`, `npm run db:reset`, `npm run db:test`, and `npm run db:stop`. GitHub `database-validation` clean replay is mandatory.

## Stop conditions

Stop for a dirty preflight tree, `origin/main` other than `e1ec4b3f65d2dfa3c4340b71ffac9a5477de0af2`, an open or overlapping PR, migration-history mismatch beyond the supplied verified facts, any SQL-content difference, need for another migration or file, Production history edit or other Production call, clean migration replay failure, production high-or-critical dependency finding, any full-tree critical finding, or conflict with a canonical security contract.

## Git and PR rules

Prefer one commit named `chore: reconcile seller admin migration version`. Push only `chore/pr-43-reconcile-seller-admin-migration`; open Draft PR #43 against `main`; do not mark ready, merge, deploy, modify Production, create/deactivate SELLERs, change Auth/memberships/secrets, or clean remote branches.

## Completion report

Record preflight, starting and final HEAD, commit, exact changed files, old and new migration paths, SQL byte-identity and 100% rename proof, exact canonical wording, confirmation that PR #44 features remain unimplemented, validation and test counts, pgTAP/clean replay, audits, GitHub CI, Vercel Preview, Draft PR URL/state, deviations, and explicit confirmation of no Production/Supabase/SELLER/Auth/Gmail/Cron/Vault/secret mutation.

## Recommended model and reasoning

Medium reasoning is appropriate because this is a documentation and byte-identical migration-filename reconciliation with no SQL-body, authorization, or functional change. The existing PR #42 security review and enforcement remain unchanged.

## Owner approval point

Only the owner may approve merge, deployment, any Production migration-history action, Production smoke, real SELLER mutation, or future PR #44 feature work. None is authorized by this PR.
