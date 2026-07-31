# PROJECT STATE

## Rolling state

- Active branch purpose: maintain the local Supabase V2 authorization baseline
- Active frontend baseline: React + Vite + TypeScript sign-in-only access gate
- Active backend baseline: local migrations and pgTAP database tests
- Legacy reference location: `legacy/firebase-prototype/`

## Fixed contracts

- Firebase data and accounts are not being migrated.
- Roles are planned as `buyer_admin`, `buyer_operator`, and `trader`.
- Public signup is not allowed.
- Approved BUYER accounts may number three or more.
- Every approved BUYER will be able to see all bids and all quotes, with views for all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access will require verified membership in an approved organization and will be limited to explicitly allowed bid and quote scope.
- Authorization will never trust `user_metadata` or other unverified client claims.
- Accounts, organizations, memberships, and the fail-closed current-access-context RPC are implemented in PostgreSQL.
- Suspended or inactive users will immediately lose access.
- `created_by` will be immutable and kept separate from the actor performing update, close, reopen, award, or cancel operations.
- Deadlines will use server time, and quote creation or modification after close will be rejected server-side.
- Close, reopen, award, and cancel will be server-side transactional operations.
- Browser code will use only the Supabase publishable key.
- Secret and service-role credentials will never enter browser code, Vite variables, or the repository.
- The frontend authorized shell requires at least one context returned by `public.current_access_context()`; an Auth session alone is insufficient.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Implemented baseline

- The PR #1 application foundation is complete.
- Local Supabase migration replay and pgTAP database tests run locally when Docker is available and in GitHub CI.
- `app_private` contains private account, organization, and membership authorization data. The authenticated public RPC returns only active, server-verified membership context.
- A sign-in-only frontend Auth boundary hydrates browser sessions, rechecks the RPC on Auth changes, preserves all returned contexts, and fails closed for missing configuration, zero context, stale requests, and transient errors.
- Unit tests cover the frontend state machine. A loopback-only integration harness uses elevated local access only for fixture setup and cleanup while normal sign-in and RPC calls use the publishable key.
- No remote Supabase project is linked, and no actual user, organization, or bidding data is committed.

## Not yet implemented

- Public signup, invitations, password reset, and administration/provisioning flows.
- Bids, quotes, audits, deadline controls, and bid lifecycle transition policies.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
