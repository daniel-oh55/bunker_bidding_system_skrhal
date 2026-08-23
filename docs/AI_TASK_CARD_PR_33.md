# AI Task Card — PR #33 Final BUYER/TRADER Operational UX/UI Polish

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@5ac69e6a3ab1b7a8848d7a59a11443f542e244f5`
- Working branch: `feat/pr-33-final-workspace-ui-polish`
- Target PR and expected HEAD: Draft PR #33 against `main`; final HEAD to be recorded at handoff
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no conflicting open PR

## Current migration state

- Repository migrations: unchanged by this frontend-only PR
- Local clean-replay status: not required because no backend or database behavior is in scope
- Remote applied status: not queried or inferred; this PR does not link or mutate a remote Supabase project

## Single purpose

Polish the existing BUYER and TRADER workspace presentation and operational hierarchy without changing workflows, data loading, mutations, authorization, Realtime invalidation, or product contracts.

## Protected business invariant

All workspace data and lifecycle decisions remain server-authoritative. BUYER visibility, creator grouping and filters, explicit manual award, TRADER organization isolation and own-quote-only visibility, server totals, server deadlines, post-mutation reloads, Realtime invalidation, and manual Refresh remain functionally unchanged. Countdown, rank, and client estimates remain presentation only.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Approved BUYER | Existing server-verified membership | Existing all-bid/all-quote workspace | Existing explicit bid creation | Existing editable fields only | Existing server-authorized close, reopen, cancel, scope, and award actions | Clearer hierarchy with identical authority and behavior |
| Authorized TRADER | Existing organization membership and bid scope | Existing accessible bids and own-organization quote only | Existing own quote creation | Existing own quote update while permitted | No new transition authority | Clearer requirement/editor/result states without competitor data |
| Unauthorized or out-of-scope actor | Fails existing server checks | No additional data | No additional action | No additional action | No additional action | UI polish does not weaken server denial |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BUYER and TRADER visibility | Unchanged | Existing policies unchanged | Existing list/detail RPCs unchanged | Reorganize only already-returned values |
| Lifecycle and award | Unchanged | Existing policies unchanged | Existing transitions and manual award remain authoritative | Distinguish informational, editable, lifecycle, and destructive controls |
| Deadline and totals | Unchanged | Existing policies unchanged | Server state and quote total remain authoritative | Label countdown/client estimate as advisory and emphasize server values |
| Realtime and reload | Not applicable | Existing private channel boundary unchanged | Existing reload functions unchanged | Preserve Refresh and post-mutation authoritative reload |

## Allowed files

- `PROJECT_STATE.md`
- `docs/AI_TASK_CARD_PR_33.md`
- `src/styles.css`
- `src/ui/workspace-ui.tsx`
- `src/ui/workspace-ui.test.tsx`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/bidding/buyer-bid-detail.tsx`
- `src/bidding/buyer-bid-detail.test.tsx`
- `src/bidding/trader-workspace.tsx`
- `src/bidding/trader-workspace.test.tsx`
- `src/bidding/bid-form.tsx`
- `src/bidding/bid-form.test.tsx`

## Forbidden scope

No backend, RPC, type/data contract, Auth, RLS, Realtime, migration, Supabase, dependency, package, CI, Vercel, legacy, mailbox/provider, secret, automatic bid creation, or automatic award change. No competitor quote data may enter the TRADER workspace.

## Database and migration plan

None. This is a presentation-only frontend PR and no database command is required.

## Test scenarios

- Positive, denial, and cross-organization cases: retain existing BUYER filter/group/selection/detail/quote/award coverage and TRADER own-quote/terminal/no-competitor coverage; add only targeted semantic presentation assertions where needed.
- Client-claim bypass, inactive/suspended, and privilege cases: no client authority or access logic changes; existing suite remains the regression boundary.
- Concurrency cases where relevant: not applicable because no mutation or database behavior changes.

## Validation commands

Run `npm ci`; all requested npm audits; lint; typecheck; Vitest; build; foundation checker; diff check; status and allowlist checks. Perform focused local browser QA at approximately 1440×900, 1024×768, and 390×844 if the existing runtime can be exercised without dependencies.

## Stop conditions

Stop for a dirty tree or base mismatch, unexpected open PR, any need for backend/data/Auth/Realtime/dependency/migration work, competitor data in TRADER, a required file outside the allowlist, or a production audit hard gate.

## Git and PR rules

Create one commit titled `feat: polish buyer and trader operational workspace`, push only the feature branch, and open a Draft PR with the same title against `main`. Do not mark ready, merge, deploy Production, apply migrations, connect a mailbox/provider, configure secrets, change Vercel settings, clean branches, or begin another PR.

## Completion report

Record repository/branch, starting and final HEAD, exact files, BUYER/quote-board/TRADER changes, responsive and accessibility behavior, tests and totals, audits, lint, typecheck, build, foundation checker, visual QA, Draft PR, exact-head CI jobs, Vercel preview, and confirmation of no forbidden backend or operational changes.

## Recommended model and reasoning

GPT-5.6 Terra with medium reasoning was requested for this frontend presentation work.

## Owner approval point

The Draft PR is the handoff boundary. Human approval is required before readiness, merge, or deployment.
