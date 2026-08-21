# AI Task Card

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@797705766a238ca09c327475fbacace15accdbd6`
- Working branch: `feat/pr-29-buyer-creator-groups`
- Target PR and expected HEAD: Draft PR #29 against `main`; exact final HEAD recorded at handoff
- Working tree status: clean at preflight; `origin` verified as `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`; no Git operation or conflicting open PR

## Current migration state

- Repository migrations: unchanged by this presentation-only PR
- Local clean-replay status: not required solely for this presentation-only PR
- Remote applied status: not inferred or changed; exact-head database-validation CI remains the database gate

## Single purpose

Group the already loaded BUYER All bids array by immutable bid creator and provide independent, local expand/collapse controls for each creator group without changing server calls, data authority, or other views.

## Protected business invariant

Every approved BUYER retains server-authorized visibility of all bids and quotes. Creator grouping is a presentation projection over the authoritative server-returned array: it uses immutable `created_by`, displays `created_by_label`, preserves server order, and does not reinterpret responsible-BUYER ownership or authorization.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Approved BUYER | Existing server-verified active membership | View authoritative bids/quotes; group All bids by creator; expand/collapse groups locally | Existing behavior unchanged | Existing behavior unchanged | Existing behavior unchanged | All bids remain initially visible; local grouping does not change authority or RPCs |
| Inactive, suspended, or unauthorized user | Server rejects or no longer verifies access | Denied and failed closed | Denied | Denied | Denied | Existing authorization failure path remains unchanged |
| Browser/client claims | Any client-supplied role, organization, membership, or metadata | Not authoritative | Not authoritative | Not authoritative | Not authoritative | No grouping or access decision trusts client claims |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Bid creator is immutable and distinct from responsible BUYER | Existing database contract unchanged | Existing visibility/mutation policy unchanged | Existing `listBids` views and arguments unchanged | All bids group by `created_by` and label with `created_by_label` |
| All approved BUYER visibility remains authoritative | Unchanged | Existing policy remains final authority | Existing list/detail RPCs remain final authority | Collapse hides only rendered cards and never clears loaded detail |
| Server order is authoritative | N/A | N/A | Existing returned array order remains unchanged | First creator occurrence and within-group bid order are preserved without sorting |

## Allowed files

- `docs/AI_TASK_CARD_PR_29.md`
- `PROJECT_STATE.md`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

No changes to server queries, `listBids` semantics, authorization, lifecycle, Realtime, detail loading, quote/award behavior, Auth/session plumbing, database/RLS/RPC/migrations, TRADER UI, dependencies, deployment, Production configuration, or legacy reference material.

## Database and migration plan

None. This PR changes presentation only. No migration will be created, rewritten, linked, applied, or rolled back.

## Test scenarios

- Positive, denial, and cross-organization cases: verify creator-key grouping, server label use, same-responsible-BUYER separation, stable group/card order, initially expanded and independent collapse controls; preserve existing authorization failure tests.
- Client-claim bypass, inactive/suspended, and privilege cases: no new client identity or authority inputs; existing fail-closed coverage remains unchanged.
- Concurrency cases where relevant: no server mutation or concurrency contract changes; verify collapse/expand performs no list or detail RPC and selected detail remains intact.

## Validation commands

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run check:foundation
git diff --check
git diff --name-only main...HEAD
git status --short
```

Local Supabase replay is not required for this presentation-only PR. Exact-head database-validation CI must pass.

## Stop conditions

Stop for a dirty preflight tree, origin or exact-base mismatch, diverged main, local work that would need discarding, an in-progress Git operation, a conflicting open PR, any required file outside the allowed list, or a conflict with a canonical authorization, lifecycle, RPC, ordering, detail-loading, or Realtime contract.

## Git and PR rules

- Commit as `feat: group buyer bids by creator`.
- Open Draft PR #29 titled `feat: group buyer bids by creator` against `main`.
- Do not mark Ready, merge, deploy, modify Production, delete branches, or run `npm audit fix --force`.

## Completion report

Record preflight and safe fast-forward; starting and final HEAD; commits and exact files; grouping and collapse behavior; unchanged `listBids` arguments and data-authority contracts; tests and audits; lint, typecheck, build, foundation, and diff results; Draft PR URL and exact-head CI/Vercel state; deviations; and confirmation that the PR remains Draft and unmerged.

## Recommended model and reasoning

GPT-5.6 Terra / medium, as requested for this focused presentation refinement.

## Owner approval point

Human review is required before marking the Draft PR Ready, merging, deploying, or changing any Production or Supabase configuration.
