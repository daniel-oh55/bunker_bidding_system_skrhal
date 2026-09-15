# AI Task Card — PR #66

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@7183b07d489cd7e125d51a3d406908929de4e0f3`
- Working branch: `feat/pr-66-seller-master-rename-delete`
- Target PR: Draft PR #66
- Working tree status: clean at branch creation

## Current migration state

- Repository migrations: through `20260907093100_bid_archive_retention.sql`
- Local clean-replay status: to be validated
- Remote applied status: intentionally unconnected; not inferred

## Single purpose

Let a server-verified active `buyer_admin` rename a TRADER/SELLER organization, or permanently delete one only when it has neither memberships nor retained operational or commercial history.

## Protected business invariant

Only an active BUYER administrator verified from the server-side membership may mutate a TRADER organization. Rename preserves identity, kind, and status. Delete retains append-only administration audit history and must fail closed when any protected relationship exists; no user, membership, BID, response, quote, award, or audit is deleted as a side effect.

## Actor and action matrix

| Actor | Precondition | Rename / delete | Expected result |
| --- | --- | --- | --- |
| BUYER admin | Active, authenticated server-verified membership | TRADER target | Allowed subject to optimistic snapshot and deletion retention checks |
| BUYER operator, TRADER, anon | Any | Any | Denied |
| Inactive or suspended membership/user | Any | Any | Denied |
| Forged membership ID | Any | Any | Denied |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- |
| Authorized mutation | organization and FK constraints | direct private-table access remains revoked | active BUYER-admin helper | workspace gate only |
| Rename conflict/name rules | partial normalized TRADER unique index | n/a | lock and expected label/status comparison | trim and length validation |
| Hard-delete retention | restrictive FKs plus explicit dependency checks | n/a | lock, check, audit tombstone, delete | target-bound warning; no eligibility inference |

## Allowed files

The files listed in the PR #66 request only, including exactly two new migrations and the focused database/frontend tests.

## Forbidden scope

No canonical product/security/architecture rewrite, auth or membership provisioning change, generic status editor, reactivation, BID/quote/award/archive behavior change, deployment, remote Supabase change, or production action.

## Database and migration plan

1. Add the new enum labels in a standalone migration.
2. Evolve the audit constraint/index/FK contract, then add guarded rename/delete RPCs in a second migration.
3. Test authorization, optimistic concurrency, snapshots, retention blockers, and append-only behavior.

## Test scenarios

- Positive and denial cases: active admin rename/delete; operator/TRADER/anon/forged/inactive/suspended denials; BUYER target denial.
- Retention and bypass cases: membership, BID access, response, quote, award, and audit dependencies block delete without a tombstone.
- Concurrency: relationship insertion and deletion are serialized by the organization lock and FKs.

## Validation commands

Run the requested npm checks, clean local Supabase replay/pgTAP when Docker is available, the focused concurrency regression if added, and `git diff --check`.

## Stop conditions

Stop for a dirty tree, wrong base/origin, local-main divergence, migration-history mismatch, unexpected existing data, canonical-contract conflict, or need for reset/rebase/force.

## Git and PR rules

Commit only this scope; push and open/maintain Draft PR #66 only if authorized by available credentials. Do not mark ready, merge, deploy, or apply production migrations.

## Recommended model and reasoning

High reasoning and independent security review for authorization, RLS/SECURITY DEFINER, audit retention, and concurrency.

## Owner approval point

Production migration, rollback, deploy, merge, and release readiness require owner approval.
