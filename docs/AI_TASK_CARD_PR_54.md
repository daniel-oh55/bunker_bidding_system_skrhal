# AI Task Card — PR #54

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `615e6a59e6495ba61eaec9f731ee16607819320e`
- Working branch: `feat/pr-54-buyer-personal-bid-order`
- Target PR and expected HEAD: draft PR #54; HEAD recorded at handoff
- Working tree status: clean at preflight; PR #54 scoped changes in progress on the working branch

## Current migration state

- Repository migrations: 17 before this PR; 18 after its single new migration
- Local clean-replay status: to be run before handoff
- Remote applied status: Production remains at 15 applied migrations; no remote project is connected or changed

## Single purpose

Persist a private, per-authenticated-BUYER ordering of BID cards for each BID operational date, with drag/drop and accessible move controls.

## Protected business invariant

Personal order is presentation-only and belongs only to the authenticated, server-verified active BUYER user plus BID date. It cannot affect BID visibility, lifecycle, audit, revision, participants, quotes, awards, organization boundaries, or any other business authority. A missing preference never hides a BID.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| active BUYER admin/operator | authenticated active account, membership, and BUYER org | own date order via RPC | own state/order via RPC | own complete date order with matching revision | none | allowed |
| active TRADER | authenticated | none | none | none | none | denied |
| anon, forged membership, inactive account/membership/org | n/a | none | none | none | none | denied |
| another active BUYER | authenticated | own date order only | own state/order only | own date order only | none | cannot target another user |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| private user/date state | PK `(user_id, bid_date)` | enabled; no browser policies | derives user from active BUYER actor | never sends user ID |
| complete valid ordering | FK/check/unique BID and positions | n/a | validates exact authoritative BID set/date | sends complete full-date array |
| stale-save protection | state revision | n/a | locks state and requires expected revision | reloads/reverts on `40001` |
| creator grouping | n/a | n/a | n/a | ranks only within immutable creator groups in All view |

## Allowed files

The PR #54 brief's listed migration, test, concurrency script/CI, BID client/UI/test, CSS, canonical docs, and this task card only.

## Forbidden scope

No existing migration edits; no Mail Intake/Gmail/Auth frontend/TRADER/Award/lifecycle/SELLER/Realtime authority changes; no legacy, deployment, secret, production, or remote Supabase changes.

## Database and migration plan

Create private state and preference tables with private privileges/RLS, plus narrow `public.get_my_bid_order` and `public.save_my_bid_order` SECURITY DEFINER RPCs. Reuse the existing active BUYER verifier and `list_bids` order (`created_at DESC, id`) for complete-order fallback. Save serializes first writes, validates the complete BID-date set, replaces only the caller's rows, and increments only preference revision.

## Test scenarios

- Positive, denial, and cross-organization cases: both BUYER roles allowed; trader/forged/inactive denied; independent user orders.
- Client-claim bypass, inactive/suspended, and privilege cases: no user-id argument; fixed search path; private tables lack direct browser privileges.
- Concurrency cases where relevant: deterministic two-session first-write and existing-state optimistic revision races using blocking-pid inspection.

## Validation commands

`npm ci`, audits, lint, typecheck, unit tests, build, foundation check, diff check, local clean database reset/pgTAP/concurrency when Docker is available.

## Stop conditions

Stop for a dirty tree, HEAD mismatch, migration-history mismatch, unexpected existing data, or conflict with a canonical contract.

## Git and PR rules

One draft PR only; no merge, Ready state, deploy, remote migration, or production mutation. Independent Claude security/concurrency review is required after implementation.

## Completion report

Record starting and final HEAD; exact files; migration; tests/audits/CI; deviations; and confirmation of no deploy, merge, or production change.

## Recommended model and reasoning

GPT-5.6 Terra, high reasoning.

## Owner approval point

Production migration, rollback, deployment, merge, and marking Ready require owner approval and are out of scope.
