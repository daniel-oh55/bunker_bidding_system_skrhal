# AI Task Card — PR #21

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@da8087c06c66779af8d29d11b55be71fe6cd2471`
- Working branch: `feat/pr-21-secure-realtime-notification-foundation`
- Target PR and expected HEAD: Draft PR #21; starting HEAD is the approved base and no commit exists.
- Working tree status: uncommitted PR #21 implementation limited to the approved changed-file set; all work remains on this branch until validated and committed.

## Current migration state

- Repository migrations: six reviewed migrations on the approved base; this PR adds one forward-only local migration.
- Local clean-replay status: must be established by `npm run db:reset` before handoff.
- Remote applied status: no remote project is connected or may be changed.

## Single purpose

Add an authorization-checked, private Supabase Realtime Broadcast invalidation foundation for BUYER, organization-wide TRADER, and per-user access topics.

## Protected business invariant

Realtime messages contain only the approved minimal invalidation markers and never authorize or reveal bidding data. A TRADER's organization topic is authorized by active organization membership, while bid visibility and mutation authority remain exclusively enforced by the existing server RPCs and current bid-scope relation. Revoking one bid scope emits one final invalidation to the removed organization but does not revoke its active organization-topic subscription.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | Active buyer account, membership, organization, and buyer role | Subscribe to `workspace:buyer` | None | None | Receive invalidations | Allowed |
| Active TRADER A | Active trader account and membership in organization A | Subscribe to `workspace:trader:A` | None | None | Receive invalidations for A's current bid scopes | Allowed |
| Active TRADER A | Active membership in A, but no scope for Bid X after revoke | Subscribe to `workspace:trader:A`; refetch Bid X | None | Existing bid RPC mutation | Receive final revoke invalidation; RPC cannot return or mutate X | Topic allowed; bid authority denied |
| Active TRADER A | Any membership | Subscribe to buyer or organization B topic | None | None | None | Denied |
| Authenticated user | Valid session | Subscribe to own `workspace:access:<user>` | None | None | Receive account/membership/organization invalidation | Allowed |
| Anonymous or browser caller | None / application caller | Subscribe to protected topic or publish Broadcast | Publish | None | None | Denied |
| Inactive or suspended account, membership, or organization | Invalid current server context | Subscribe to business topic | None | None | Access change causes fresh evaluation to fail | Denied |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Broadcast topic join | N/A | Exact authenticated `realtime.messages` SELECT policy, Broadcast extension only | `current_access_context()` derives active context from server rows | May resubscribe/refetch only |
| Broadcast send | N/A | No application INSERT policy or table grant | Private fixed-search-path `SECURITY DEFINER` trigger functions call `realtime.send` | None |
| Bid visibility and mutation after revoke | Existing scope relation | Private tables | Existing bid/quote RPCs re-evaluate current access | Invalidation triggers refetch; cannot grant access |
| Revocation hint | N/A | N/A | DELETE trigger sends one final minimal message to removed organization | Discard stale local bid data after refetch |

## Allowed files

- `supabase/migrations/20260808090000_realtime_workspace_notifications.sql`
- `supabase/tests/database/04_realtime_workspace_notifications.sql`
- `scripts/test-realtime-workspace-notifications.mjs`
- `PROJECT_STATE.md`
- `README.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_21.md`
- `.github/workflows/ci.yml`
- `package.json`
- `scripts/test-realtime-workspace-notifications.mjs`
- `supabase/migrations/20260808090000_realtime_workspace_notifications.sql`
- `supabase/tests/database/04_realtime_workspace_notifications.sql`

## Forbidden scope

- Legacy Firebase files, frontend Realtime UI, remote Supabase/Vercel changes, deployment, project linking, secrets, bid-specific topics, direct private-table client access, and protected data in payloads.

## Database and migration plan

1. Add one authenticated Broadcast-only SELECT policy using current server-derived membership context and own-user access topics.
2. Add private fixed-search-path `SECURITY DEFINER` send/trigger functions and revoke all application execute privileges.
3. Fan out bid changes only to currently scoped trader organizations; fan out access-row DELETE once to the removed organization.
4. Prove policy, privilege, payload, trigger, and corrected revoke semantics in pgTAP and the local Realtime integration harness.

## Test scenarios

- Positive, denial, and cross-organization cases: exact buyer/trader/access topic joins; role and organization denials; anonymous denial; no browser publish permission.
- Client-claim bypass, inactive/suspended, and privilege cases: context is database-derived; no INSERT/anon policy; inactive account, membership, and organization cannot newly join business topics; functions and private tables remain inaccessible.
- Revoke lifecycle: Bid X invalidates A before revoke, revoke sends one final invalidation, authoritative RPC hides and rejects access to X, A reconnects to its organization topic, later X-only change does not notify A, and still-scoped Bid Y does notify A.
- Concurrency cases where relevant: existing bid/quote/membership concurrency suites remain required; Realtime is an invalidation hint and does not alter their server transactions.

## Validation commands

Run the repository-required audit, static, unit, build, foundation, local database, pgTAP, existing concurrency/Auth/quote integration, and new Realtime integration commands. Docker is required for the local database commands.

## Stop conditions

Stop for a dirty tree beyond the two reported drafts, HEAD/base mismatch, migration-history mismatch, unexpected fixture data, a Realtime policy behavior incompatible with the contract, or a need for remote mutation.

## Git and PR rules

Stay on the named branch. After all required local validation passes, commit only the approved files, push the branch, and create or update PR #21 as Draft. Do not mark it ready, merge, link a remote project, deploy, or change Production.

## Completion report

Record starting/final HEAD, exact changed files, migration and tests, audits and validation outcomes, deviations, no-deploy/no-merge confirmation, the organization-wide topic result, final revoke invalidation, RPC invisibility, successful rejoin, no later Bid X notification, and continued Bid Y notification.

## Recommended model and reasoning

High reasoning and independent security review are required because this changes authorization policy, `SECURITY DEFINER` functions, triggers, and revocation behavior.

## Owner approval point

Production migration, remote configuration, deployment, release, or rollback requires owner approval and is out of scope.
