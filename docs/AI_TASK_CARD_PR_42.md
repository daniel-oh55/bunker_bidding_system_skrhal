# AI Task Card: PR #42 SELLER master management

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `aa07e24092e8715e0430946f42be0425474b79d8`
- Working branch: `feat/pr-42-seller-master-management`
- Target PR and expected HEAD: Draft PR #42; one implementation commit on the working branch
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no open overlapping PR

## Current migration state

- Repository migrations: eleven migrations at the base, ending in `20260826010503_enable_gmail_polling_extensions`; this PR adds exactly `20260827090000_trader_organization_admin.sql`
- Local clean-replay status: passed in an isolated temporary Supabase project on alternate ports; all 12 migrations replayed and all 550 pgTAP assertions passed across 9 files, including 75 PR #42 assertions
- Remote applied status: not queried or inferred; Production application remains owner-approved and outside this PR

## Single purpose

Add server-authorized BUYER-admin SELLER master management and its BUYER UI while preserving SELLER as the user-facing name for the existing internal TRADER organization model.

## Protected business invariant

Only an active, server-verified `buyer_admin` may list all TRADER organizations for administration, create an active TRADER organization, or transition an active TRADER organization to inactive. Creation provisions an organization only, never Auth users, memberships, or BID scope. Deactivation never deletes the organization, memberships, retained BID scope, quotes, awards, or audit history. No reactivation or generic status-update authority is introduced because retained old BID scopes could otherwise revive access without an explicit future design.

Data ownership and organization boundary: the actor must be the authenticated user attached to the submitted active BUYER membership, in an active BUYER organization, with `buyer_admin` role. The target remains an `app_private.organizations` row with `kind = trader`.

Stop/recovery behavior: authorization failures clear SELLER-admin state and invoke the existing access recheck; local protocol, validation, duplicate, lifecycle, and transport failures remain isolated to the management surface. SQL mutations are transactional, target rows are locked for deactivation, and idempotent repeat deactivation creates no second audit event.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| `buyer_admin` | Authenticated user, active account/membership/BUYER organization | Admin list including inactive/suspended | Active TRADER organization only | None | Active to inactive only | Allowed through reviewed RPCs |
| `buyer_operator` | Even when fully active | Existing normal BUYER bidding reads only | Existing bid operations only | Existing bid operations only | Existing bid lifecycle only | All SELLER-admin RPCs denied |
| `trader` | Even when fully active and scoped | Existing scoped TRADER reads only | No SELLER admin | No SELLER admin | No SELLER admin | All SELLER-admin RPCs denied |
| `anon` / unauthenticated | None | No admin list | No create | None | No deactivate | EXECUTE denied / fail closed |
| Direct authenticated table caller | Any client claim | No private table read | No direct insert | No direct update | No direct delete | RLS and privileges deny direct CRUD |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Normalized SELLER identity | Partial unique index on `lower(btrim(name))` for all TRADER statuses | Private table remains RLS-enabled | Creation trims and bounds to 120 characters | Trimmed name and duplicate error shown locally |
| Admin authority | Existing role/kind constraints remain | No direct private access | New private active BUYER-admin helper verifies `auth.uid()` and stored rows | Control visible only for server-returned `buyer_admin`; presentation only |
| Organization-only creation | Kind/status database types | No direct insert | RPC inserts only one active TRADER organization, audits, invalidates BUYER workspace | Explicit no-login/no-invitation notice |
| Safe deactivation | Status enum and retained foreign keys | No direct update/delete | Row lock; active to inactive; inactive idempotent; suspended rejected | Target-bound two-step warning; no reactivate action |
| Append-only audit | Restrictive foreign keys and bounded snapshots | RLS enabled, no policies | Private append helper called only from admin RPCs | No audit UI |
| Strict protocol | N/A | N/A | Narrow result columns only | Exact-key UUID/status/count/timestamp parsers |

## Allowed files

1. `supabase/migrations/20260827090000_trader_organization_admin.sql`
2. `supabase/tests/database/08_trader_organization_admin.sql`
3. `src/bidding/types.ts`
4. `src/bidding/types.test.ts`
5. `src/bidding/bidding-client.ts`
6. `src/bidding/bidding-client.test.ts`
7. `src/bidding/seller-management.tsx`
8. `src/bidding/seller-management.test.tsx`
9. `src/bidding/context-workspace.tsx`
10. `src/bidding/context-workspace.test.tsx`
11. `src/bidding/buyer-workspace.tsx`
12. `src/bidding/buyer-workspace.test.tsx`
13. `src/styles.css`
14. `docs/AI_TASK_CARD_PR_42.md`
15. `PROJECT_STATE.md`
16. `docs/PRODUCT_AND_SCOPE.md`
17. `docs/SECURITY_MODEL.md`

## Forbidden scope

No default/new/old BID participation or scope grant/backfill, unquoted board rows, quote placeholders, login/invite/account or membership provisioning, delete, reactivate, rename, generic status update, bid creation, mail/Gmail changes, Production Supabase/data/Auth/Vercel mutation, deployment, secrets, legacy imports, or old migration edits.

## Database and migration plan

Create one forward migration containing a TRADER-only normalized unique index, private enum/table/helper functions for append-only admin audit, a dedicated active BUYER-admin actor helper, and three narrow authenticated RPCs. Preserve the generic active BUYER helper and existing active TRADER list. Creation calls the existing private BUYER workspace invalidation helper. Deactivation relies on the existing organization update trigger for access and workspace invalidation.

## Test scenarios

- Positive, denial, and cross-organization cases: active BUYER-admin list/create/deactivate; active BUYER-operator, TRADER, anon, forged membership, inactive/suspended context denial; all-status list and deterministic ordering.
- Client-claim bypass, inactive/suspended, and privilege cases: normalized duplicates across every TRADER status, BUYER-name exclusion, direct CRUD denial, fixed search paths and exact grants, suspended target rejection, idempotent inactive target, bounded audit snapshots, no identity exposure.
- Retention cases: organization, memberships, BID scopes, quotes, awards/history remain; deactivated members lose existing active access and scoped bid visibility.
- Concurrency cases where relevant: the unique index is authoritative for concurrent normalized-name creation; deactivation row locking serializes repeated transitions so exactly one transition audit is possible.
- Frontend: role visibility, exact RPC args, strict parsing, add/deactivate flows, target-bound confirmation, pending locks, refreshes, authorization fail-closed behavior, local non-authorization errors, Realtime-triggered refresh without stale overwrite.

## Validation commands

Run `npm ci`, all specified audit commands, lint, typecheck, full Vitest, build, foundation check, `git diff --check`, then safe local Supabase start/reset/test/stop. GitHub clean replay remains mandatory if Docker is unavailable.

## Stop conditions

Stop for a dirty tree, HEAD mismatch, migration-history mismatch, overlapping PR, unexpected existing data, additional-file requirement, direct browser table write, BUYER-operator mutation authority, hard delete, reactivation, destructive old-scope cleanup, Auth provisioning, Production mutation, audit hard-gate failure, or conflict with a canonical contract.

## Git and PR rules

Prefer one commit named `feat: add seller master management`. Push only `feat/pr-42-seller-master-management`; open Draft PR #42 against `main`; do not mark ready, merge, deploy, apply Production migration, mutate real SELLERs, modify Auth/memberships/secrets, or clean branches.

## Completion report

Record preflight, starting/final HEAD, commit, exact files and migration, database contracts and denial results, uniqueness/deactivation/audit/Realtime behavior, frontend UX, focused/full/pgTAP counts, audits and static/build checks, GitHub CI, Vercel Preview, Draft PR URL/state, deviations, and explicit confirmation of no Production Supabase/Auth/Gmail/Vercel/real-SELLER mutation.

## Recommended model and reasoning

High reasoning is required because this change introduces membership authorization, `SECURITY DEFINER` functions, append-only audit, lifecycle transition, and concurrent uniqueness/deactivation behavior. Codex implements; an independent security-focused review is required before handoff when the configured review capability is available.

## Owner approval point

Only the owner may approve merge, Production migration application, Production smoke activity, any later reactivation design, or deployment. Production application remains expressly outside PR #42.
