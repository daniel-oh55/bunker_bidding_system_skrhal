# AI Task Card - PR #38

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `a2231bdebb0976b300079c9f6946402dfe191fbd`
- Working branch: `chore/pr-38-reconcile-gmail-production-rollout`
- Target PR and expected HEAD: Draft PR #38; final reconciliation commit pending
- Working tree status: clean before the branch was created from the exact base

## Current migration state

- Repository migrations: restore `20260826010503_enable_gmail_polling_extensions.sql` as the eleventh migration, matching the already-applied Production history.
- Local clean-replay status: passed with all eleven migrations applied and all 475 pgTAP tests green in an isolated alternate-port Supabase stack because the repository's default database port was occupied by an unrelated local project; repository configuration was not changed.
- Remote applied status: all eleven migrations, ending with `20260826010503_enable_gmail_polling_extensions`, were independently verified as already applied in Production; this PR does not link, inspect, repair, or mutate the remote project.

## Single purpose

Reconcile the repository and canonical documentation with the already-completed Production Gmail connector and scheduled-polling rollout, including restoration of the already-applied polling-extension migration, without changing runtime application behavior.

## Protected business invariant

Repository history must accurately and portably represent the already-applied Production schema while owner-controlled Production configuration remains outside replayable migrations. The restored migration may enable only `pg_cron` and `pg_net`; it must not schedule the Gmail connector, create or read Vault secrets, embed environment-specific values, or authorize any Production action.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Local migration replay | Local Supabase is available | Repository migrations | `pg_cron` and `pg_net` extensions if absent | None | Apply migration 11 | Clean replay succeeds with eleven migrations and pgTAP remains green |
| Production Gmail connector | Existing owner-controlled deployment and secrets | Gmail `INBOX` read-only after trigger authentication | Bounded normalized pending candidates for exact `//SPOT//` mail | Existing cursor through CAS | Existing review-only intake flow | Already-verified behavior is documented, not changed by this PR |
| Active approved BUYER | Existing server-verified membership | Shared pending normalized candidates | Bid only through the unchanged explicit `createBid` path | Dismiss through the existing revision-checked RPC | Pending to dismissed | Existing review/dismiss boundary remains unchanged |
| TRADER, browser caller, or unauthorized connector caller | No permitted intake authority | None | None | None | None | Existing server denial remains unchanged |
| Repository contributor | This PR scope | Symbolic Cron/Vault names only | Documentation and exact migration restoration | Canonical state statements | None | No secret, endpoint value, Cron registration, or Production mutation enters the repository |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Portable extension restoration | Migration contains only the two recorded `create extension if not exists` statements | Unchanged | Unchanged | Unchanged |
| Cron and Vault remain owner-controlled Production configuration | No schedule, secret creation, URL, or secret value in the migration | Unchanged | Existing connector trigger and cursor/ingest boundaries unchanged | No connector surface added |
| Intake remains review-only | Existing bounded queue constraints unchanged | Existing private queue policies unchanged | Existing ingest/list/dismiss and `createBid` separation unchanged | BUYER review/dismiss remains; TRADERs have no mail-intake access |

## Allowed files

- `supabase/migrations/20260826010503_enable_gmail_polling_extensions.sql`
- `docs/AI_TASK_CARD_PR_38.md`
- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`

## Forbidden scope

No runtime application or Edge Function changes; no remote Supabase link, migration push/repair/history manipulation, Production extension change, Cron creation or alteration, Vault access, Gmail invocation, secret access or registration, deployment, operational-data access, automatic historical import, intake-to-bid conversion, automatic bid creation, legacy change, or unrelated refactor.

## Database and migration plan

Restore the exact Production-recorded extension statements as migration `20260826010503`, then prove compatibility through local clean replay. The migration is a repository-history restoration only and is not authorization to reapply or change Production. Cron scheduling and Vault entries are environment-specific owner-controlled configuration and deliberately remain outside migrations.

## Test scenarios

- Positive: the local baseline replays all eleven migrations and both required extensions can be enabled idempotently.
- Denial and bypass: diff inspection confirms no Cron job, Vault secret, project URL, trigger secret, runtime behavior, or file outside the allowlist was added.
- Authorization: existing pgTAP coverage remains green; no RLS, RPC, role, queue, BUYER, or TRADER contract changes.
- Concurrency: not applicable; no transactional data or cursor behavior changes.

## Validation commands

Run `npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; `npm run lint`; `npm run typecheck`; `npm run test -- --run`; `npm run test:edge`; `npm run build`; `npm run check:foundation`; `git diff --check`; then `npm run db:start`; `npm run db:reset`; `npm run db:test`; and `npm run db:stop` when local Docker/Supabase is available.

## Stop conditions

Stop for base SHA movement, an overlapping PR, dirty or in-progress Git state, migration filename/version conflict, invalid local clean replay, a required file outside the allowlist, canonical conflict with verified facts, secret or operational-detail exposure, or a blocking audit result.

## Git and PR rules

Prefer one reconciliation commit; push only `chore/pr-38-reconcile-gmail-production-rollout`; open Draft PR #38 against `main`. Do not mark Ready, merge, deploy, invoke Gmail, alter Cron/Vault, or mutate Production. Report a GitHub-assigned PR number mismatch.

## Completion report

Record preflight, starting and final HEAD, commit, exact files and migration contents, canonical reconciliation, validations, audit classification, Draft PR URL/state, prohibited-action confirmation, and deviations.

## Recommended model and reasoning

Medium reasoning is appropriate because this is a constrained documentation and already-applied migration reconciliation with no authorization or runtime change.

## Owner approval point

Owner approval remains required for merge, deployment, any Production change, remote migration action, Gmail invocation, Cron/Vault alteration, or scope expansion.
