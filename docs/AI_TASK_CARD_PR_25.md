# AI Task Card — PR #25 Shared Workspace UI Foundation

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Origin: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@2805a2cec81567329ce2f623296236954cea571a`
- Working branch: `feat/pr-25-shared-workspace-ui-foundation`
- Target PR and expected HEAD: Draft PR to `main`; expected HEAD recorded at completion.
- Working tree status: clean before branch creation.

## Current migration state

- Repository migrations: unchanged.
- Local clean-replay status: not required for this UI-only PR.
- Remote applied status: not inspected or changed; no remote Supabase project is linked.

## Single purpose

Add small, reusable presentational foundations to the authorized BUYER and TRADER workspaces: a shared summary, status badge, empty state, and a restrained responsive CSS token system.

## Protected business invariant

Only server-returned membership contexts authorize a workspace. Membership ID remains the identity input; organization labels remain presentation-only. This PR must leave authorization, RPC data contracts, data mutation, keyed context reset, selected-context Realtime subscription, manual refresh, and authoritative reload behavior unchanged.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Authorized BUYER | Server-returned BUYER membership context | Existing server/RPC read paths | Existing workflow only | Existing workflow only | Existing workflow only | Same business behavior with shared presentation |
| Authorized TRADER | Server-returned TRADER membership context and server scope | Existing server/RPC read paths | Existing quote workflow only | Existing quote workflow only | None | Same business behavior with shared presentation |
| Unauthorized, inactive, or stale actor | No currently authorized server context | No protected content | Denied | Denied | Denied | Existing fail-closed clearing and recheck |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Membership and organization authorization | Unchanged | Unchanged | Unchanged | Presentation receives no authorization inputs |
| Bid/quote lifecycle and concurrency | Unchanged | Unchanged | Unchanged | Existing statuses are displayed without reinterpretation |

## Allowed files

- `docs/AI_TASK_CARD_PR_25.md`
- `PROJECT_STATE.md`
- `src/ui/workspace-ui.tsx`
- `src/ui/workspace-ui.test.tsx`
- `src/bidding/context-workspace.tsx`
- `src/bidding/context-workspace.test.tsx`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/bidding/trader-workspace.tsx`
- `src/bidding/trader-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

No changes to App/Auth/Realtime clients, `bidding-client.ts`, business types, workflows, Supabase, database migrations/RLS/functions/triggers, dependencies, CI, environment/secrets, Vercel, Production, or the legacy Firebase reference.

## Database and migration plan

None. No database objects, data, or configuration will be changed.

## Test scenarios

- Positive: shared summary, text-bearing status badge, and empty state render supplied presentation data.
- Denial and bypass: existing BUYER/TRADER authorization failure tests remain unchanged and must pass.
- Lifecycle: existing BUYER raw/effective and TRADER effective status assertions remain intact.
- Empty/loading: BUYER zero-result, responsible-BUYER instruction, and TRADER zero-result presentation remain distinct.
- Concurrency: existing stale-operation and authoritative reload tests remain unchanged and must pass.

## Validation commands

`npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; `npm run lint`; `npm run typecheck`; `npm run test -- --run`; `npm run build`; `npm run check:foundation`; `git diff --check`; `git diff --name-only main...HEAD`; `git status --short`.

## Stop conditions

Stop for a dirty tree, origin/base mismatch, main divergence, in-progress Git operation, conflicting open PR, a need to modify a non-allowed file, a changed canonical contract, or a required validation hard-gate failure.

## Git and PR rules

Commit as `feat: add shared workspace UI foundation`; open a Draft PR against `main`; do not mark ready, merge, deploy, or modify Production.

## Completion report

Record final HEAD, changed files, shared primitives, presentation-only workspace changes, test/audit/CI results, deviations, and Draft/unmerged status.

## Recommended model and reasoning

Medium reasoning: small UI and documentation change. No security-sensitive authority logic is modified.

## Owner approval point

Owner approval is required before a Draft PR is marked ready, merged, deployed, or any Production state is changed.
