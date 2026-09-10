# AI Task Card — PR #64

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `9ae44f4efc42aadf9df5fcfc10cd21ac2b74d9b4`
- Working branch: `feat/pr-64-buyer-workspace-v11-visual-foundation`
- Target PR and expected HEAD: Draft PR #64; no merge or deploy.
- Working tree status: clean before task-card creation.

## Current migration state

- Repository migrations: preserved; no migration changes intended.
- Local clean-replay status: not required before frontend implementation; database commands remain part of final validation when Docker is available.
- Remote applied status: unconnected; no remote mutation authorized.

## Single purpose

Establish the V1.1 visual foundation for the deployed BUYER workspace without changing any product, backend, or security authority.

## Protected business invariant

Only existing server-side authorization and contracts control BID visibility, creation, lifecycle, quote eligibility, awards, archival, ordering persistence, and deadline enforcement. Countdown and comparison presentation remain client-side advisory views of server-provided data.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| BUYER | Existing scoped membership and server authority | Existing active and archived BID data | Existing composer only | Existing ordering RPC only | Existing lifecycle controls in Manage BID only | Compact visual presentation; server result remains authoritative |
| TRADER | Existing scoped membership and server authority | Existing accessible BID and own quote data | N/A | Existing quote response only | N/A | One-second advisory countdown with seconds; no competitor data exposed |
| Unauthorized/cross-org actor | No valid server authorization | Denied by existing RLS/RPC | Denied | Denied | Denied | No new client authority or data path |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BID/quote/award/archive authority | Existing | Existing | Existing | Presentation only; no new mutation or interpretation |
| Deadline authority | Existing | Existing | Existing | Countdown updates per second and labels itself advisory |
| Personal BID ordering | Existing | Existing | Existing save-order contract | Top drag strip plus keyboard button fallback |

## Allowed files

- `src/bidding/context-workspace.tsx`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-bid-board-card.tsx`
- `src/bidding/trader-workspace.tsx`
- `src/styles.css`
- Focused frontend tests and this task card.

## Forbidden scope

No Auth, membership, RLS, RPC, database schema, migrations, audit, Realtime authority, Gmail/Mail Intake behavior, lifecycle, quote, archive, production, dependency, or deployment changes. Do not add sorting, alternate layouts, BID numbers, invented data, award behavior, server functionality, vessel imagery, or external APIs.

## Database and migration plan

None. This is frontend-only.

## Test scenarios

- Active/Archived mode and BID-view controls remain accessible segmented controls.
- All-bids creator grouping remains immutable; personal ordering keeps drag and Move earlier/later fallback.
- Buyer and Trader countdowns update every second, show seconds, and cannot override server-editability.
- Seller comparison retains every seller/quote value, current eligibility and lowest-offer semantics, and a narrow-screen scroll fallback.
- Existing authorization, denial, stale-response, and ordering-conflict tests remain green.
- No new concurrency behavior; existing server ordering and lifecycle concurrency remains unchanged.

## Validation commands

`npm ci`; production audit; lint; typecheck; tests; build; foundation check; diff check; and prescribed local database commands when Docker is available.

## Stop conditions

Stop for a dirty tree, base mismatch, forbidden contract change, new backend requirement, failed protected test, or validation issue that requires prohibited scope.

## Git and PR rules

Open one Draft PR only after the requested checks. Do not mark Ready, merge, deploy, link a remote Supabase project, or modify Production.

## Completion report

Record starting and final SHAs, files, tests, audits, validation, deviations, and confirmation of no backend, remote-production, merge, or deploy mutation.

## Recommended model and reasoning

Medium reasoning for visual frontend work; focused review of countdown and ordering invariants.

## Owner approval point

Required before any scope expansion, production action, non-fast-forward Git operation, or backend change.
