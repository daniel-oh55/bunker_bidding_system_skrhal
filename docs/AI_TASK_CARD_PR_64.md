# AI Task Card — PR #64 final visual refinements

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `9ae44f4efc42aadf9df5fcfc10cd21ac2b74d9b4`
- Working branch: `feat/pr-64-buyer-workspace-v11-visual-foundation`
- Target PR and expected starting HEAD: Draft PR #64 at `03694a7e5e9bb5ce9d2733fe56889707267f6a53`
- Working tree status: clean before implementation.

## Current migration state

- Repository migrations: unchanged.
- Local clean-replay status: database start blocked by an unrelated local Supabase project already bound to port `54322`; no reset or external project stop was performed.
- Remote applied status: unconnected and unchanged.

## Single purpose

Apply only the final requested visual refinements to the PR #64 BUYER board and TRADER card presentation.

## Protected business invariant

Comparison ranks remain presentation of server-returned quote data only; they neither authorize nor select awards. Server deadlines remain the lifecycle authority, and displayed countdowns remain advisory only.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| authorized BUYER | existing server-authorized workspace access | existing comparison data | none | local presentation only | none | compact ranks, heading, totals, countdown, and drag grip |
| authorized TRADER | existing server-authorized workspace access | existing assigned BID data | none | local countdown presentation only | none | compact deadline/countdown display |
| unauthorized actor | no existing authorization | unchanged | none | none | none | existing server and application denial unchanged |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| comparison, award, and deadline authority | unchanged | unchanged | unchanged | mirrors returned data without adding authority |

## Allowed files

The two affected frontend components, shared stylesheet, focused frontend tests, and this task card.

## Forbidden scope

Backend, RPC, RLS, Auth, membership, database, migrations, award behavior, Archive, ordering persistence, Mail Intake, Realtime, dependencies, Production, and all PR #65 functionality.

## Database and migration plan

None.

## Test scenarios

- Compact rank `1` retains lowest-row highlighting and separate awarded text.
- Single comparison heading, seller/current-quote counts, compact total header, and server-total label remain present.
- BUYER and TRADER deadline cards show parenthesized advisory countdowns without repeated visible advisory text; expired and no-deadline meanings remain intact.
- Whole top drag region retains its accessible label/title, drag events, and footer move controls.

## Validation commands

`npm audit --omit=dev --audit-level=high`, lint, typecheck, unit tests, build, foundation check, and diff check.

## Stop conditions

Stop for a dirty tree, HEAD/base mismatch, protected-contract regression, or a required change outside this frontend-only scope.

## Git and PR rules

Commit and push only to Draft PR #64. Do not mark Ready, merge, deploy, link Supabase, or mutate Production.

## Completion report

Record final HEAD, delta files, validation results, and confirmation of no backend, deploy, merge, or Production action.

## Recommended model and reasoning

Medium reasoning; frontend-only visual refinement.

## Owner approval point

Any scope expansion or Production action requires owner approval.
