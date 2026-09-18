# AI Task Card — PR #68

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@aef0992da93fa2bbcbe474f826faf4e6dcd1fc84`
- Working branch: `feat/pr-68-seller-registration-ui`
- Target PR: Draft PR #68
- Working tree status: clean before branch creation

## Current migration state

- Repository migrations: includes the merged PR #67 seller-registration backend migration.
- Local clean-replay status: not yet run; no migration is created or changed by this PR.
- Remote applied status: intentionally unknown; no remote project is connected or changed.

## Single purpose

Expose the PR #67 SELLER candidate signup, invitation, registration request, and BUYER-admin approval APIs through a browser feature-flagged, fail-closed React UI.

## Protected business invariant

Only server-returned active access contexts open a workspace. Browser enrollment, invitation verification, organization text, selected context, and feature flags are presentation only; a BUYER admin must map an eligible candidate to an existing active TRADER organization through the backend RPC.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Signed-out visitor | Flag exact `true` | Auth controls | SELLER Auth signup | — | — | Confirmation guidance only |
| Invited candidate | Valid invite OTP | — | — | Own password | — | Still no workspace without server context |
| Inactive confirmed candidate | No active context | Own request | Own request | Resubmit after rejection | — | Pending/rejected/approved-denied UI |
| BUYER operator | Active operator context | Existing workspace only | — | — | — | No registration administration UI |
| BUYER admin | Active buyer-admin context | Pending requests/active sellers | Invite request | Approve/reject via RPC | Candidate to active trader membership | Server remains authoritative |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Candidate cannot self-authorize | PR #67 schema | Private tables | PR #67 RPC guards | Never mounts workspace without returned context |
| Buyer approval targets active trader | PR #67 checks | Private tables | `approve_seller_registration_request` | Selector presents active traders only |
| Admin-only invitation/approval | — | — | Edge/RPC server authorization | buyer-admin selected context gates presentation |

## Allowed files

Only the PR brief's approved UI, test, documentation, env typing, and task-card files; files are touched only when necessary.

## Forbidden scope

No migrations, database tests, Edge implementation, production configuration, dependencies, CI, legacy Firebase material, deploy, remote Supabase, Auth, SMTP, or production action.

## Database and migration plan

None. This PR consumes exact existing PR #67 APIs.

## Test scenarios

- Exact feature-flag enablement; signed-out sign-in/recovery regression; signup and invite behavior.
- Candidate request states, malformed responses, access invalidation, and no-context denial.
- Buyer-admin invite/list/approve/reject, stale and authorization failure handling; buyer-operator denial.
- Existing buyer, trader, seller-management, authentication recovery, and protocol tests.

## Validation commands

`npm ci`; audit classification commands; lint; typecheck; unit tests; build; foundation boundary check; diff check. Local database regression only if an independently safe local stack is available.

## Stop conditions

Stop for base mismatch, dirty tree, migration-history mismatch, unexpected production/remote state, a need to change an excluded file, or a conflict with the existing PR #67 contract.

## Git and PR rules

Commit/push and create only a Draft PR after validation. Do not ready, merge, deploy, link a project, or alter production.

## Recommended model and reasoning

High reasoning for Auth, authorization boundary, Realtime recheck, and strict protocol parsing; independent review before handoff.

## Owner approval point

Separate owner-approved PR #69 production migration/Auth/SMTP/template/Edge rollout and feature-flag activation.
