# AI Task Card — PR #49

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` / `origin/main` at `e76ad9c6d14b767b8b7a42b4b8a7b22457f25400`
- Working branch: `feat/pr-49-seller-quote-response-model`
- Target PR: Draft PR #49; no Ready, merge, deploy, or Production action
- Working tree status: clean after an `--ff-only` local-main synchronization

## Current migration state

- Repository migrations: fifteen; the repository-only final migration is `20260901090000_seller_quote_response_model.sql`.
- Local clean-replay status: must be established by the required local database validation.
- Remote applied status: fourteen Production-applied migrations, ending with `20260831071010_bid_operational_date.sql`; this task must not connect, apply, or otherwise modify Production.

## Single purpose

Introduce retained per-BID/TRADER-organization commercial response state (`awaiting`, `quoted`, `gave_up`) without changing explicit BID access as the authorization authority.

## Protected business invariant

Only an active, server-verified TRADER membership in an active TRADER organization with current explicit BID access can mutate that organization’s response, and only on the current Seoul operational date while the BID is effective-open. A response row is commercial history—not authorization—and access revoke must not delete response, quote, or audit history.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | Verified active BUYER membership | BID comparison/history | BID / scope | Scope | Award a quoted eligible response | Server-authorized only |
| Active scoped TRADER | Verified active TRADER membership/org, today, effective-open | Own BID/response only | First quote internally | Own price | awaiting→quoted/gave_up; quoted→gave_up; gave_up→quoted | Response revision increments once |
| Other/inactive/revoked TRADER | Missing any required server check | No scoped BID/competitor data | None | None | None | Denied |
| Browser/direct table caller | Any | No private direct access | None | None | None | RLS/no policies/revoked privileges |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| One retained response per BID/org | composite PK; bounded status/revision checks | Private/no policies | response initialization/backfill | Status labels |
| Current mutation authority | — | Private/no policies | BID-first lock and active actor/access/date/lifecycle checks | Disable terminal actions only |
| Commercial history/audit | append-only trigger | Private/no policies | server-derived actor/snapshots | No direct audit UI required |
| Award eligibility | response status is `quoted` | — | `quote_result` and `award_bid` verify | Exclude gave-up values/rank |

## Allowed files

- One new Supabase migration and directly related database tests/integration scripts
- Focused upgrade-backfill fixture, regression harness, and its directly related pgTAP assertion
- `src/bidding/types.ts`, `bidding-client.ts`, `trader-workspace.tsx`, `buyer-bid-board-card.tsx`, their direct tests, and necessary styles
- `PROJECT_STATE.md`, `docs/PRODUCT_AND_SCOPE.md`, `docs/SECURITY_MODEL.md`, `docs/ARCHITECTURE.md`
- This task card and `docs/AI_REVIEW_PR_49.md`

## Forbidden scope

No legacy Firebase import, Gmail/mail-intake changes, account administration expansion, Production connection/apply, secrets, deploy, Ready transition, or merge.

## Database and migration plan

Create the retained response and append-only response-audit private tables; backfill their current rows from access ∪ quotes without synthetic events; create initial slots in `create_bid`; preserve grant/revoke BID revision/audit behavior; replace browser quote writes with response-oriented RPCs; enforce BID→response→quote lock ordering; update award/comparison/list result shapes; and revoke obsolete browser mutation RPCs.

## Test scenarios

- Positive: slot initialization/backfill, including an upgrade fixture with overlapping scope+quote, scope-only, and quote-only pairs; submit/update/give-up/resume (including identical retained values), award eligibility and buyer/trader presentation.
- Denial: cross-org, revoked, inactive, historical-date, deadline, cancelled/awarded, stale response/quote revision, and direct table/RPC privilege access.
- Concurrency: BID-first give-up versus update and deadline/award races.

## Validation commands

Run the repository-required audits, frontend checks, local Supabase replay/pgTAP when Docker is safely available, and quote/trader/realtime/concurrency integration scripts.

## Stop conditions

Stop for dirty tree, base mismatch, incompatible migration history, contract conflict, or unsafe local database availability.

## Git and PR rules

Use focused commits, push only the named branch, open Draft PR #49 after validation, and never mark Ready or merge.

## Completion report

Report the prescribed preflight, exact files/migration, security/RPC/audit/UI/lock behavior, all validation states, CI/Preview/PR state, deployment ordering, and explicit confirmation that Production/secrets/deploy were untouched.

## Recommended model and reasoning

GPT-5.6 Terra / High.

## Owner approval point

Owner approval is required for any Production migration/apply, deployment, Ready transition, or merge; none is authorized here.
