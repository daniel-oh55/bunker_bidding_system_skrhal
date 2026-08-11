# AI Task Card — PR #23 Frontend Private Realtime Consumer

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` / `651e0e667086d2367af4dfc4150894626610ada9`
- Working branch: `feat/pr-23-frontend-private-realtime`
- Target PR and expected HEAD: Draft PR #23; implementation commit recorded at handoff
- Working tree status: clean before branch creation

## Current migration state

- Repository migrations: seven reviewed migrations; latest is `20260808090000_realtime_workspace_notifications.sql`.
- Local clean-replay status: not changed by this frontend-only task.
- Remote applied status: seven reviewed migrations are recorded as applied to Production.

## Single purpose

Consume existing private Realtime Broadcast invalidations in the browser. Broadcast is only a best-effort prompt for the already-authoritative access or workspace RPC reload paths.

## Protected business invariant

Business data and authorization continue to originate solely in existing server RPCs. The browser accepts only exact `access_changed` and `workspace_changed` markers, opens only private selected-context subscriptions, and discards stale callbacks and reloads.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Authenticated user | Authorized session | Own access marker | None | None | Revalidate access | `current_access_context()` controls continued workspace access |
| Selected BUYER | Server-returned selected membership | BUYER marker | None | None | Authoritative reload | Existing BUYER RPC reload preserves valid UI state |
| Selected TRADER | Server-returned selected membership | Selected organization marker | None | None | Authoritative reload | Existing TRADER RPC reload |
| Any browser client | Any | No arbitrary topic or payload | Denied | Denied | No Broadcast send | No publish interface or public fallback |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Broadcast receipt | Existing private channel configuration | Existing `realtime.messages` policy | Existing notification functions | Private adapter subscribes only to fixed topics |
| Continued access | N/A | Existing RLS | `current_access_context()` | Recheck hides workspace pending response |
| Workspace values | N/A | Existing RLS | Existing bidding RPCs | Invalidation reloads; never renders payload |

## Allowed files

The Task Card allowed source, test, and four canonical documentation files, plus `src/realtime/realtime-client.ts` and its test. No scope expansion is required.

## Forbidden scope

No migration, database policy/function, dependency, secret, deployment, workflow, provisioning, or legacy change. No Realtime publishing or public fallback.

## Database and migration plan

None. This task consumes the reviewed existing Realtime foundation unchanged.

## Test scenarios

- Private self, BUYER, and selected TRADER topics; wrong payload rejection; cleanup and late callback rejection.
- Multi-BUYER deduplication; selected-TRADER switch cleanup; workspace RPC reload.
- Access invalidation recheck, zero-context denial, stale workspace cleanup, sign-out/recovery via existing state machine, manual Refresh and post-mutation reload retention.

## Validation commands

Run the required npm audit, lint, typecheck, test, build, foundation, diff, and local database command set from `AGENTS.md` where Docker is available.

## Stop conditions

Stop for dirty base tree, base SHA mismatch, migration mismatch, canonical-contract conflict, required backend authorization change, dependency update, or required out-of-scope file.

## Git and PR rules

Commit only this scope, push the dedicated branch, and open a Draft PR targeting `main`. Do not deploy, merge, mark ready, or delete branches.

## Completion report

Record exact final commit, files, validation/audit results, PR/CI state, deviations, and confirmation of no database, Production, secret, deployment, or merge action.

## Recommended model and reasoning

GPT-5.6 Terra / High. The access/reload lifecycle is security-sensitive and is covered with focused tests.

## Owner approval point

Stop after implementation, validation, push, and Draft PR creation for exact-HEAD/diff/CI verification and independent security review.
