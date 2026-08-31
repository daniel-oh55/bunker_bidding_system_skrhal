# AI Task Card — PR #46 Quantity Range Parser

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `d10fd7b0cf5cbfe04977b7550360c8e09c859e91`
- Working branch: `fix/pr-46-quantity-range-parser`
- Target PR and expected HEAD: Draft PR #46 against `main`; one implementation commit preferred
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no overlapping open PR

## Current migration state

- Repository migrations: thirteen existing migrations; this task adds or changes none
- Local clean-replay status: not run because another local Supabase project was active on the standard ports; this parser-only task changes no database artifact, and GitHub database validation remains the clean-replay gate
- Remote applied status: repository documentation records all thirteen migrations as applied; no remote project is linked or inspected for this task

## Single purpose

Accept supported-fuel quantity ranges in the existing shared advisory bunker-request parser, use the valid lower/left bound as the review candidate, and add a non-blocking verification warning.

## Protected business invariant

Parser output remains review-only and non-authoritative. A valid range may suggest only its exact positive lower bound for a supported grade. It never retains the upper bound in storage, creates a BID, infers a deadline or responsible BUYER, infers SELLER/TRADER authority, or mutates database state. Invalid, non-positive, malformed, and descending ranges remain rejected through the existing invalid-quantity warning path.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Shared parser caller | Plain-text subject/body supplied within the existing adapter boundary | Input strings in memory | Review-only normalized draft | None | None | Valid range yields the lower candidate and verification warning |
| Gmail connector | Existing exact case-sensitive first-character `//SPOT//` gate passed | Existing bounded inline plain text | Existing normalized queue ingress only | None | Existing cursor flow only | Shared parser result reaches the unchanged ingest RPC payload |
| BUYER reviewer | Existing server-verified BUYER access | Existing preview or pending candidate | Bid only through unchanged explicit Create bid action/RPC | Human may edit candidates | Existing authorized lifecycle only | Range output grants no authority |
| TRADER, anonymous, or unauthorized caller | Any | No new access | No parser-created bid or authority | None | None | Existing authorization boundaries remain unchanged |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Range bounds use the existing numeric grammar and must be positive and ordered | Pure parser logic | Unchanged | Unchanged | Invalid range uses the existing warning path |
| Valid range imports only its lower bound | No database change | Unchanged | Existing normalized ingest unchanged | Review candidate plus verification warning |
| Output remains advisory | No schema change | Existing policies unchanged | Existing create/ingest contracts unchanged | Candidates never submit or authorize a bid |
| Gmail exact marker, cursor, and raw-data boundaries | Unchanged | Unchanged | Connector source unchanged | Focused synthetic Edge regression only |

## Allowed files

1. `src/bidding/bid-intake.ts`
2. `src/bidding/bid-intake.test.ts`
3. `supabase/functions/tests/gmail-mail-intake.test.ts`
4. `docs/AI_TASK_CARD_PR_46.md`
5. `PROJECT_STATE.md`
6. `docs/PRODUCT_AND_SCOPE.md`

## Forbidden scope

Do not change SQL, migrations, RLS/RPC/schema, Gmail connector source, exact-marker eligibility, cursor/reset/rescan semantics, queue data or idempotency, Auth/membership, BID creation, dates/deadlines, Cron/Vault/secrets, Production data/configuration, deployments, or legacy Firebase. Do not reparse existing pending rows or use real operational fixtures.

## Database and migration plan

No database, SQL, migration, RLS, RPC, data, or remote-state change. PostgreSQL persistence and authorization remain unchanged; the parser is a pure advisory input helper.

## Test scenarios

- Positive: compact/spaced hyphen, ASCII tilde, en dash, em dash, full-width tilde, case-insensitive MT, M/T, comma-formatted, and decimal ranges import exact lower values and warn for verification.
- Negative and bypass: zero/negative lower, zero upper, descending range, malformed upper, and ordinary invalid tokens produce the existing invalid-quantity warning and no candidate.
- Regression: decimal and comma-formatted single quantities, all aliases, supported specification rows, unsupported/generic fuels, and conflicting aliases retain existing behavior.
- Connector: one synthetic exact-marker Gmail message sends lower-bound fuel items and verification warnings to `ingest_mail_intake_item`, without invalid-quantity warnings.
- Authorization, organization, denial, and concurrency: unchanged and not applicable to this pure parser change; existing connector, queue, and database tests remain the enforcement gates.

## Validation commands

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run src/bidding/bid-intake.test.ts
npm run test:edge
npm run test -- --run
npm run build
npm run check:foundation
git diff --check
```

No database migration is added. GitHub `database-validation` remains the clean-replay gate for this parser-only PR.

## Stop conditions

Stop for a base SHA mismatch, dirty preflight, overlapping PR, required SQL/RPC/connector-source change, any file outside the allowlist, real operational data, Production/cursor/queue mutation, or an audit hard-gate failure.

## Git and PR rules

Prefer one commit named `fix: parse bunker quantity ranges`. Push only `fix/pr-46-quantity-range-parser` and open Draft PR #46 against `main`. Do not mark Ready, merge, deploy, invoke the Production connector, reset cursors, or alter queue rows.

## Completion report

Record preflight; starting and final HEAD; branch and commit; exact files; accepted separators/forms; valid/invalid behavior; focused/Edge/full tests; audits; lint/typecheck/build/foundation/diff; exact-head CI and Preview; Draft PR state; deviations; and explicit confirmation of no SQL/RPC, Production, Gmail, cursor, queue, deployment, or pending-row reparse action.

## Recommended model and reasoning

Medium reasoning is appropriate because this is a pure parser, test, and documentation change with no authorization, migration, deadline, lifecycle transition, or concurrency implementation.

## Owner approval point

After merge, any Production Gmail Edge deployment or controlled smoke requires explicit owner approval. Repository implementation does not deploy the parser or reparse existing pending rows.
