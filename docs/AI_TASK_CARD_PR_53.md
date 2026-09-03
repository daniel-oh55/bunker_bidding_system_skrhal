# AI Task Card — PR #53

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `b7f061dadb67d9e97ce2487d870b3fa62440e960`
- Working branch: `feat/pr-53-buyer-bids-board-redesign`
- Target PR: Draft PR #53; no merge or deploy
- Working tree status: clean before task-card creation

## Current migration state

- Repository migrations: preserved; no migration changes intended.
- Local clean-replay status: blocked locally because an unrelated `ai-family-investment-os` Supabase project owns port 54322; no external container was stopped.
- Remote applied status: unconnected; no remote mutation authorized.

## Single purpose

Redesign the BUYER BIDS workspace so its board is the primary operational surface, retaining every existing frontend-to-server contract.

## Protected business invariant

Only the server authorizes BID creation, seller selection, lifecycle transitions, quoting, award, and visibility. The UI must accurately reflect the current Seoul operational-date context and never add authority.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| BUYER | Current Seoul date and existing server authority | Existing scoped BID/intake data | Open manual or prepared composer | Local draft only before Publish | Publish invokes existing server contract | Server reloads authoritative result |
| BUYER | Historical date | Existing date-scoped BID/intake data | Denied in UI | Dismiss intake remains available | No Publish/Prepare | Concise contextual explanation |
| buyer_admin | Existing server authority | Seller management | N/A | Existing seller management only | N/A | Panel remains available |
| buyer_operator | Existing server authority | Buyer workspace | N/A | N/A | N/A | No Seller Management panel |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BID publication and selected SELLER scope | Existing | Existing | Existing authoritative publish function | Composer is available only for current Seoul date |
| Mail preparation | Existing | Existing | Existing publish/dismiss functions | Prepare is unavailable on historical dates; Dismiss remains available |
| Award and status | Existing | Existing | Existing server-authorized lifecycle | Card displays comparison/advisory status without mutation |

## Allowed files

- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-bid-board-card.tsx`
- `src/bidding/bid-form.tsx`
- `src/bidding/mail-intake-queue.tsx`
- `src/styles.css`
- Focused existing component tests and this task card.

## Forbidden scope

No Supabase, RLS, RPC, authorization, audit, deadline, award semantics, client contract, Auth, Realtime, backend, dependency, CI, or legacy changes.

## Database and migration plan

None. This is frontend-only.

## Test scenarios

- Primary BIDS ordering, toolbar, current/historical composer behavior, date-change clearing, Mail Intake dismissal/preparation, admin-only Seller Management, and unchanged list arguments/grouping/detail focus.
- Card response, eligibility/rank, closed/awarded, and authoritative-award semantics.
- No concurrency change; existing server concurrency behavior remains untouched.

## Validation commands

`npm ci`; audit classification commands; lint; typecheck; tests; build; foundation check; diff check; and prescribed local database commands when Docker is available.

## Stop conditions

Stop for a dirty tree, base mismatch, new required production file, unexpected backend requirement, failing protected contract, or validation issue requiring forbidden scope.

## Git and PR rules

Open one Draft PR only after checks and exact-head CI success. Do not mark Ready, merge, deploy, link a remote Supabase project, or clean branches.

## Completion report

Record base/final SHAs, commits, files, DOM order, behavior, tests, audits, exact-head CI/preview, deviations, and confirmation of no backend or production mutation.

## Recommended model and reasoning

GPT-5.6 Terra, medium reasoning.

## Owner approval point

Required before any scope expansion, production action, non-fast-forward Git operation, or backend change.
