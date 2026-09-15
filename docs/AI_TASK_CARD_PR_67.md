# AI Task Card — PR #67

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@f4cdc089c23277e240acee1b1fd10de96da7e3e8`
- Working branch: `feat/pr-67-seller-registration-backend`
- Target PR: Draft PR #67
- Working tree status: clean at branch creation

## Current migration state

- Repository migrations: through `20260911090100_trader_organization_rename_delete.sql`
- Local clean-replay status: to be validated
- Remote applied status: intentionally unconnected; not inferred

## Single purpose

Implement V1.1 SELLER candidate enrollment and server-authorized BUYER approval without granting business access at Auth enrollment.

## Protected business invariant

An Auth identity is not business authorization. Until a server-verified active BUYER administrator approves an eligible pending applicant into an existing active TRADER organization, the applicant remains inactive with no membership, no access context, BID, or quote access.

## Actor and action matrix

| Actor | Precondition | Action | Expected result |
| --- | --- | --- | --- |
| Authenticated candidate | Confirmed email, inactive, no memberships | Submit/view own request | Allowed |
| Active BUYER admin | Server-verified active BUYER-admin membership | List, approve, reject, authorize invite | Allowed |
| BUYER operator, TRADER, anon, inactive/suspended or forged actor | Any | Administrative actions | Denied |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- |
| Candidate isolation | state-shape and pending uniqueness constraints | private tables revoked | caller-bound RPCs | PR #68 only |
| Approval authority | membership/FK compatibility | private tables revoked | existing buyer-admin helper | PR #68 only |
| Audit retention | append-only trigger | private tables revoked | server-only append helper | none |

## Allowed files

Only the PR #67 file list supplied by the owner.

## Forbidden scope

No public BUYER onboarding, automatic organization matching/creation, BID scope, production Auth/SMTP/deployment, or frontend workflow.

## Database and migration plan

One forward migration adds private requests/audit, caller-bound RPCs, serialized applicant locking, and audited approval/rejection.

## Test scenarios

- Confirmed inactive candidate submission and own-request isolation.
- Admin-only approval/rejection/invite authorization; no client metadata authority.
- Duplicate submit, two-admin approval, approve/reject, and approval/submission races.

## Validation commands

Run the owner-required Node, app, database, Auth, Edge, and whitespace checks where available.

## Stop conditions

Stop for base/origin divergence, dirty tree, migration mismatch, canonical-contract conflict, or destructive Git need.

## Git and PR rules

No ready-for-review, merge, deploy, remote Supabase/Auth/SMTP change, or production migration.

## Completion report

Record exact HEADs, files, migration, tests, audits, CI, deviations, and no-production-action confirmation.

## Recommended model and reasoning

High reasoning and independent security review for authorization, `SECURITY DEFINER`, audit, and concurrency.

## Owner approval point

Production migration, configuration, deploy, merge, and release readiness require owner approval.
