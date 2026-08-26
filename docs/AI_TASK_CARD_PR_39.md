# AI Task Card: PR #39 BUYER operational bid board

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `3ce5b91eb3bd8d4f030e3f03a173cfaa3d915ddd`
- Working branch: `feat/pr-39-buyer-bid-board`
- Target PR and expected HEAD: Draft PR #39 against `main`; implementation commit to be recorded at handoff
- Working tree status: clean at preflight; only the eight allowed PR files may change during implementation

## Current migration state

- Repository migrations: eleven existing migrations; no migration is added or changed by this PR
- Local clean-replay status: not run; Docker was available, but `db:start` could not bind port `54322` because another local Supabase project owned it. This repository's partial `local-placeholder` setup was stopped successfully without touching the other project; GitHub database validation remains the gate.
- Remote applied status: not queried or changed for this frontend-only PR; repository state records all eleven baseline migrations as applied to the approved Production project

## Single purpose

Replace the BUYER main bid list/detail split with a responsive operational bid board. Each bid card presents its server-returned bid summary and BUYER-visible TRADER quote comparison together, while the unchanged authoritative management detail opens below the full-width board.

## Protected business invariant

Only quotes returned by `listQuotesForBuyers(membershipId, bid.id)` for the currently active, server-verified BUYER context may be presented. The browser must not broaden quote visibility, infer authority from presentation, recompute the authoritative `total_amount`, or award a quote automatically. An authorization failure clears all protected BUYER bid, quote, buyer, organization, selection, and detail state before access revalidation. Results from superseded membership, view, reload, or unmounted generations cannot restore protected data.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active approved BUYER | Current server-verified BUYER membership | Existing bid views and per-bid BUYER-visible quotes | Existing create flow only | Existing detail flow only | Existing manual server-authorized lifecycle/award flow only | Board presents server-returned data; Manage bid opens the existing detail below it |
| Inactive/suspended/unauthorized user | Missing current active BUYER authority or quote RPC returns authorization failure | Denied | Denied | Denied | Denied | Protected board/detail/reference data is cleared and access is revalidated |
| TRADER | TRADER membership | No BUYER board access | No BUYER action | No BUYER action | No BUYER action | Existing TRADER workspace and competitor isolation are unchanged |
| Browser presentation | Active BUYER data already returned by RPCs | May format, sort, rank eligible quotes, and calculate an advisory gap | None | None | None | `Quote.total_amount` and Bid award fields remain authoritative; display calculations confer no authority |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BUYER quote visibility | Unchanged | Existing private quote RLS remains authoritative | Existing `listQuotesForBuyers` verifies membership and returns visible retained quotes | Board calls only that adapter and fails closed on authorization errors |
| Authoritative quote total | Existing backend validation/integrity unchanged | Unchanged | Existing quote RPC returns server-calculated `total_amount` | Table displays `total_amount`; it never recomputes an authoritative total |
| Award authority | Existing award relation/integrity unchanged | Unchanged | Existing manual award RPC remains the only transition | Board has only neutral Manage bid action and advisory lowest-eligible text |
| Stale protected responses | Not applicable | Server remains authoritative per request | Each request is scoped to membership and bid | List-generation guards discard superseded board quote results and per-bid state is cleared before reload |

The presentation layer mirrors server-returned eligibility for comparison only. It does not create an independent authorization, quote-total, lifecycle, or award authority.

## Allowed files

- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/bidding/buyer-bid-board-card.tsx`
- `src/bidding/buyer-bid-board-card.test.tsx`
- `src/styles.css`
- `docs/AI_TASK_CARD_PR_39.md`
- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`

## Forbidden scope

No backend, RPC, schema, migration, Auth, membership, RLS, `SECURITY DEFINER`, Realtime protocol, TRADER workspace, Gmail/parser/intake contract, Edge Function, Cron, Vault, secret, Production, deployment, or legacy Firebase change. No automatic award, invented deal number/date filter, real operational fixture, or new UI dependency.

## Database and migration plan

None. This is a frontend presentation and controlled-loading change using the existing RPC adapter. No SQL file may change.

## Quote-loading stale-response and fail-closed behavior

- After an authoritative bid-list result, each card starts with an empty loading state and its quotes are fetched through `listQuotesForBuyers`.
- At most four board quote requests run concurrently; selected detail may perform its existing duplicate quote read independently.
- Success replaces only that bid's current-generation quote state.
- Protocol, unknown, thrown, or transient per-bid failure retains no quote rows for that bid and renders an isolated unavailable state; other cards remain usable.
- Any quote authorization failure invalidates list/detail/mutation generations, clears all protected BUYER state, records the error, and invokes `onAuthorizationFailure`.
- A view, membership, reload, mutation reload, Realtime `reloadVersion`, or unmount invalidates prior list generations. Late responses from those generations are ignored.
- No quote cache survives a list/context generation.

## Test scenarios

- Positive, denial, and cross-organization cases: card summary/table rendering; dynamic requested-grade columns; authoritative total display; empty/loading/unavailable states; retained inactive/ineligible quote presentation; server-view argument preservation; immutable-creator grouping/collapse; existing detail and mutation flow; quote authorization failure clears protected state. Cross-organization visibility remains enforced by the unchanged server RPC and is not reimplemented in the browser.
- Client-claim bypass, inactive/suspended, and privilege cases: no client role/organization claim is introduced; inactive access/organization quote metadata remains visible to BUYER but de-emphasized; `eligible_for_award=false` is excluded from the advisory lowest offer; no automatic award call exists.
- Concurrency cases where relevant: four-request maximum; isolated request failures; stale responses after view-generation replacement; `reloadVersion` and post-mutation quote refresh; existing detail stale-response and award-confirmation invalidation tests remain intact.
- Advisory comparison cases: zero, one, and two-or-more eligible offers; lower ineligible quote ignored; zero gap; awarded result distinct from mathematical lowest.
- Accessibility/responsive cases: semantic article/section/table structure, focusable horizontal table region, visible selected Manage state, text metadata in addition to status color, CSS two-column-to-one-column collapse, and no fixed-width page overflow.

## Validation commands

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run
npm run test:edge
npm run build
npm run check:foundation
git diff --check
npm run db:start
npm run db:reset
npm run db:test
npm run db:stop
```

## Stop conditions

Stop for a dirty preflight tree, moved base SHA, overlapping PR, migration-history mismatch, required backend/RPC/schema or outside-allowlist file, incompatible creator/detail preservation, inability to fail closed or reject stale data, required real operational fixture, or an audit hard-gate failure.

Recovery from a per-bid non-authorization quote failure is manual Refresh, Realtime-triggered reload, or the existing post-mutation reload. Authorization failure recovery is the existing access-context revalidation path. No stale quote is retained during recovery.

## Git and PR rules

Prefer one commit named `feat: add buyer operational bid board`. Push only `feat/pr-39-buyer-bid-board`, open Draft PR #39 against `main`, and do not mark Ready, merge, deploy, or change Production.

## Completion report

Record preflight, starting and final HEAD, commit, exact files, board layout, bounded loading, fail-closed/stale guards, test counts, audits, build/foundation/database checks, Draft PR URL/state, deviations, and explicit confirmation that backend, Production, Gmail, secrets, Cron, and Vault were untouched.

## Recommended model and reasoning

High reasoning is appropriate because protected quote loading, authorization clearing, asynchronous generation guards, award presentation, and concurrency behavior are in scope even though backend authority is unchanged.

## Owner approval point

The owner-approved design direction is the current SKRHAL navy/gold/light-gray visual language with a dense responsive bid board. Human approval is still required to move the Draft PR to Ready, merge, deploy, or perform any Production action.
