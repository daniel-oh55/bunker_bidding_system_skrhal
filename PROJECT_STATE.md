# PROJECT STATE

## Rolling state

- Active branch purpose: maintain the local Supabase V2 authorization and bidding baseline
- Active frontend baseline: React + Vite + TypeScript sign-in-only access gate and integrated BUYER/TRADER workspace
- Active backend baseline: local migrations, pgTAP database tests, and server-authorized bid, quote, award, scope, and audit RPCs
- Legacy reference location: `legacy/firebase-prototype/`

## Fixed contracts

- Firebase data and accounts are not being migrated.
- Roles are `buyer_admin`, `buyer_operator`, and `trader`.
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
- Bids use raw `open`, `closed`, `awarded`, and `cancelled` states. Raw open with a non-null passed deadline is effectively closed using server time; no cron transition exists.
- Details are editable only while effective-open. After an organization quote exists, commercial terms and quantities are immutable; a real future/null deadline-only update remains possible.
- `created_by` is immutable. Cross-BUYER updates and responsibility changes record the actual actor and before/after state in append-only audit history.
- Reassignment is allowed for raw open/closed bids, not cancelled or awarded bids. Reopen requires a null or future deadline and preserves quotes; cancellation and award are irreversible in V1.
- TRADER organizations receive explicit current per-bid scope. Each organization owns one quote, active members collaborate, and scope revocation immediately removes TRADER visibility/write access without deleting retained quotes.
- BUYERs see all quotes. TRADERs do not receive competitor scope or quote data. Award is server-side and terminal in V1. The integrated BUYER/TRADER frontend workspace is implemented; it uses server RPCs, manual refresh, and post-mutation reload. Realtime remains unimplemented.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Implemented baseline

- The PR #1 application foundation is complete.
- Local Supabase migration replay and pgTAP database tests run locally when Docker is available and in GitHub CI.
- `app_private` contains private account, organization, and membership authorization data. The authenticated public RPC returns only active, server-verified membership context.
- A sign-in-only frontend Auth boundary hydrates browser sessions, rechecks the RPC on Auth changes, preserves all returned contexts, and fails closed for missing configuration, zero context, stale requests, and transient errors.
- Unit tests cover the frontend state machine. A loopback-only integration harness uses elevated local access only for fixture setup and cleanup while normal sign-in and RPC calls use the publishable key.
- Reviewed migrations are applied to the approved remote Supabase project. Remote public signup and anonymous access are disabled.
- Controlled initial provisioning is complete with three active BUYER users, two active TRADER users, one active BUYER organization, two active TRADER organizations, and five active compatible memberships.
- All five provisioned identities successfully authenticated and returned only their expected server-verified `current_access_context`; each passed an account- or membership-disable fail-closed check and was restored.
- There are currently no bids, quotes, or TRADER bid-scope rows in the approved remote Supabase project.

## Not yet implemented

- No Vercel Production deployment exists. Production Site URL and redirect configuration remain unresolved.
- No remote auth configuration push is authorized.
- Remote bid, quote, scope, deadline, and award smoke testing remains pending.
- Realtime remains unimplemented.
- Invitations, password reset, and administration/provisioning flows and UI.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
