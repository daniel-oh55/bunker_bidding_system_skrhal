# AI Task Card - PR 28 Buyer Quote Board and Deadline Countdown Parity

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `923eaa5e70389a01dd6495a4af7e051c6a3ef662`
- Working branch: `feat/pr-28-buyer-quote-board-countdown`
- Target PR and expected HEAD: Draft PR 28 scope; final HEAD to be recorded at handoff
- Working tree status: clean before branch creation; only allowed PR 28 files may change

## Current migration state

- Repository migrations: existing repository migration set is unchanged by this presentation-only PR
- Local clean-replay status: not required solely for this UI/view-model PR
- Remote applied status: not inferred because no remote Supabase project is linked for this work

## Single purpose

Refine the BUYER bid presentation into an operational, dynamically columned quote-comparison board and add advisory deadline countdown presentation for BUYER and TRADER without changing database, authorization, quote, award, deadline, reload, or Realtime contracts.

## Protected business invariant

Every approved BUYER continues to see every server-returned bid and quote, including non-awarded quotes, in the existing authoritative UI order. A TRADER continues to see only explicitly scoped bids and only its own organization's server-returned quote; competitor identity, rank, and price data never enter the TRADER UI. Effective status, editability, quote totals, and award results remain server authoritative. The client countdown is advisory text only and cannot enable, disable, close, reopen, award, create, or update anything.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Approved BUYER | Existing authorized membership | All server-returned bids, requested fuels, scoped organizations, and all quotes | Unchanged | Unchanged | Manual award and lifecycle controls unchanged | Dense quote comparison uses existing quote order and server totals; countdown is advisory |
| Scoped TRADER | Existing explicit bid scope and active authorized membership | Scoped bids and own-organization quote only | Existing `createQuote` flow | Existing `updateQuote` flow | None added | Own quote state, revision, server total, terminal result, deadline, and advisory countdown are clear |
| Unscoped or unauthorized TRADER | No valid server authorization/scope | Denied by existing server/client fail-closed flow | Denied | Denied | Denied | No bid, own quote, or competitor data displayed |
| Client clock | Deadline exists | Deadline value already returned by server | Denied | Denied | Denied | Produces display-only remaining/elapsed text; never changes effective status or editability |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BUYER can compare all returned quotes | Unchanged | Unchanged | Existing BUYER quote feed and ordering inputs unchanged | Render every returned quote in the existing sorted array |
| TRADER cannot see competitor data | Unchanged | Unchanged | Existing scoped bid and own-quote feeds unchanged | Render only `listTraderBids` and `listMyQuotes` results; no ranking or competitor fields |
| Total is server authoritative | Unchanged | Unchanged | Existing quote total calculation/response unchanged | Label preview as client estimate and returned total as authoritative server total |
| Deadline/effective status is server authoritative | Unchanged | Unchanged | Existing effective status and quote lifecycle enforcement unchanged | Countdown is descriptive only; editability continues to use `effective_status` |
| Award is manual and target-bound | Unchanged | Unchanged | Existing `awardBid` contract unchanged | Preserve two-step confirmation and exact bid/quote revision arguments |

## Allowed files

- `docs/AI_TASK_CARD_PR_28.md`
- `PROJECT_STATE.md`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/bidding/buyer-bid-detail.tsx`
- `src/bidding/buyer-bid-detail.test.tsx`
- `src/bidding/trader-workspace.tsx`
- `src/bidding/trader-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

No changes to application shell, Auth, Realtime, shared UI primitives, context workspace, bid form, bidding client, types, Supabase files, dependencies, CI, legacy reference material, Production configuration, mail ingestion, automatic award, or buyer-group behavior. Frozen list/detail/scope/quote/award/reload/invalidation/error/editability/key flows must retain their meaning, arguments, and control flow.

## Database and migration plan

No schema, RLS, RPC, function, migration, seed, or database-test change. PostgreSQL remains the authority for integrity, authorization, lifecycle, quote totals, and award state.

## Test scenarios

- Positive, denial, and cross-organization cases: verify dynamic BUYER fuel columns in bid order; rank, organization, barge fee, server total, revision, and award markers; unchanged quote ordering; BUYER/TRADER remaining-time text; all BUYER quotes retained; TRADER own-quote-only presentation with no competitor data.
- Client-claim bypass, inactive/suspended, and privilege cases: preserve existing authorization and fail-closed tests; verify an elapsed client countdown does not change open effective-status editability; do not introduce client role, organization, or lifecycle claims.
- Concurrency cases where relevant: preserve stale-operation invalidation, authoritative post-mutation reload, quote identity/revision form reset, award confirmation invalidation, and exact revision-bound award/update calls. No new concurrent mutation is introduced.

## Validation commands

Run `npm ci`, all requested audit classifications and hard gates, lint, typecheck, full Vitest run, build, foundation check, `git diff --check`, exact changed-file diff, and status. Local Supabase replay is not required for this UI/view-model-only PR.

## Stop conditions

Stop for a dirty tree before implementation, exact-base mismatch, wrong origin, divergent main, Git operation in progress, conflicting open PR, any required file outside the allowlist, any need to change frozen behavior, any server-contract or authorization change, production high-or-critical dependency finding, full-tree critical dependency finding, or loss of TRADER isolation.

## Git and PR rules

Use only `feat/pr-28-buyer-quote-board-countdown`, prefer commit `feat: add buyer quote board and countdown parity`, push without force, and open a Draft PR titled `feat: add buyer quote board and countdown parity` against `main`. Do not mark ready, merge, deploy, modify Production, or delete branches.

## Completion report

Record preflight and fast-forward, starting/final HEAD and commits, exact files, BUYER/TRADER presentation changes, frozen contract confirmation, exact quote/award call preservation, tests and count, audits, validation results, Draft PR URL, exact-head CI/Vercel status, deviations, and Draft/unmerged confirmation.

## Recommended model and reasoning

GPT-5.6 Sol with medium reasoning, as requested for presentation and focused UI test work.

## Owner approval point

Owner review is required before the Draft PR is marked ready or merged. No deployment, Production change, database action, or remote Supabase action is authorized by this task.
