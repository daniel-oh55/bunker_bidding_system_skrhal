# AI Task Card — PR #65

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@ac54838f554b2efcd94fb2d96c22c52b63d2113d`
- Working branch: `feat/pr-65-buyer-comparison-award-selection`
- Target PR and expected HEAD: Draft PR #65; expected HEAD is the single-purpose implementation commit produced by this task
- Working tree status: clean at pre-flight; only allowed PR #65 files may change during implementation

## Current migration state

- Repository migrations: 20 existing migrations through `20260907093100_bid_archive_retention.sql`; unchanged by this PR
- Local clean-replay status: to be validated if the required Docker/Supabase environment is available without affecting unrelated containers
- Remote applied status: unknown and intentionally not inferred because no remote Supabase project is connected

## Single purpose

Allow an approved BUYER to manually select any server-returned, award-eligible SELLER directly from a BID card's Buyer-visible comparison while reusing the existing `awardBid`/`award_bid` authority and mutation reload path.

## Protected business invariant

This is a discoverability and UX change only. The existing server-authoritative award contract remains the sole authority: an active server-verified BUYER may make one atomic, irreversible, manual award only for an effective-closed, non-cancelled, non-awarded BID, using a retained active quoted response with current BID access, an active SELLER/TRADER organization, and exact BID and quote revisions. The client never automatically selects the lowest quote and cannot unaward or replace an award.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | BID effective-open; quoted comparison row | Comparison and disabled Select affordance | None | None | Denied by UX and server | Learns selection is available only after close |
| Active BUYER | BID effective-closed; server says quote is award-eligible and current | Comparison and frozen confirmation facts | None | None | Confirm award through existing RPC | Exact frozen BID/quote revisions are submitted once |
| Active BUYER | Quote is non-lowest but otherwise eligible | Same as any eligible quote | None | None | Confirm award through existing RPC | Manual selection is allowed; no lowest-price automation |
| Active BUYER | Gave-up/awaiting/revoked/inactive/ineligible quote or terminal/archived BID | Historical/comparison information | None | None | Denied | No executable Select action |
| TRADER or unverified/inactive actor | Any client state | Server-scoped data only | None | None | Denied by existing RPC/RLS | UI state cannot grant award authority |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Actor and organization authority | Existing schema only | Existing policies only | Existing `award_bid` verifies active BUYER scope | Shows controls only in BUYER active workspace |
| BID lifecycle and one-way award | Existing schema only | Existing policies only | Existing RPC enforces effective-close, not awarded/cancelled, atomic irreversibility | Open/terminal/archive controls are disabled or absent |
| Quote ownership, retained status, access, organization, eligibility | Existing schema only | Existing policies only | Existing RPC remains authoritative | Uses server comparison flags and fails closed |
| Exact optimistic concurrency | Existing schema only | Existing policies only | Existing RPC requires BID and quote revisions | Confirmation freezes and submits exact revisions; signature changes invalidate it |
| Manual choice | None | None | RPC accepts the explicitly chosen eligible quote | Every eligible row, including non-lowest, may be selected; no automatic choice |

## Allowed files

- `docs/AI_TASK_CARD_PR_65.md`
- `src/bidding/buyer-bid-board-card.tsx`
- `src/bidding/buyer-bid-board-card.test.tsx`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

No bidding-client contract changes, SQL, migrations, RLS, `SECURITY DEFINER`, Auth/membership, Realtime authority, Archive semantics, quote submission, Mail Intake/Gmail, SELLER management, signup/invitation, dependency, canonical product/security documentation, deployment, remote Supabase linkage, or Production changes.

## Database and migration plan

No database or migration changes. This PR reuses the existing award RPC contract without adding or duplicating authority.

## Test scenarios

- Positive, denial, and cross-organization cases: closed eligible and non-lowest eligible selection; open, ineligible, gave-up, awaiting, revoked access, inactive organization, awarded, cancelled, and archived denial/presentation; existing server tests remain the cross-organization authority gate.
- Client-claim bypass, inactive/suspended, and privilege cases: card eligibility is derived only from server-returned comparison state; changed response/access/organization/eligibility/award state invalidates confirmation; RPC remains final authority.
- Concurrency cases where relevant: frozen exact BID/quote revisions; BID or quote revision changes invalidate confirmation; pending/submission guard prevents duplicate confirmation; conflict/lifecycle/not-found uses the existing authoritative reload path.

## Validation commands

`npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; `npm run lint`; `npm run typecheck`; `npm run test -- --run`; `npm run build`; `npm run check:foundation`; `git diff --check`; and local DB start/reset/test/stop only when the repository-required environment is available without touching unrelated containers.

## Stop conditions

Stop for a dirty tree outside the allowed files, HEAD mismatch, migration-history mismatch, unexpected existing data, contract conflict, required change outside the allowlist, repository/origin divergence, or unexpected `main` movement. Do not reset hard, rebase, force push, deploy, or modify Production.

## Git and PR rules

Commit only this PR's files, push the named branch, open Draft PR #65, and do not mark Ready, merge, deploy manually, modify Production, or delete branches.

## Completion report

Record repository, branch, starting and final exact HEAD, commits, exact files, migration files, test count/results, audit classification, validations, CI/Vercel state, deviations, and confirmation of no Ready/merge/deploy/Production action.

## Recommended model and reasoning

High reasoning because award lifecycle, exact revisions, irreversible transition UX, and stale-confirmation/concurrency guards are involved. Security-sensitive changes require independent review before handoff.

## Owner approval point

Owner approval is required before any Production migration, rollback, deploy, Ready transition, or merge. None is authorized by this task.
