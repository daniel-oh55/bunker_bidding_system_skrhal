# Product And Scope

## Goal

Rebuild the SKRHAL bunker bidding system on a Supabase-backed stack while preserving the existing Firebase prototype only as a reference artifact.

## Implemented baseline

- The PR #1 application foundation and preserved legacy reference are complete.
- Local Supabase migrations, pgTAP testing, and a CI database-validation job are implemented.
- Private accounts, organizations, memberships, and server-verified current-access context are implemented.
- A sign-in-only frontend boundary exposes a minimal shell only after the server returns active membership context.
- BUYER-only bid lifecycle, responsibility reassignment, revision locking, and append-only audit backend are implemented.

## Excluded from this phase

- public signup, invitation, password-reset, and admin-provisioning flows
- quote, award, and frontend bid workflow tables or operations
- `.msg` or `.eml` migration
- approval and submission business rules
- remote Supabase linking, deployment, or committed user, organization, or bidding data

## Future implementation contracts

These contracts are fixed for later implementation; the authorization baseline does not yet implement them:

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.
- Authorization never trusts `user_metadata` or unverified client claims, and suspended or inactive users immediately lose access.
- `created_by` is immutable and remains distinct from the active BUYER actor who updates, closes, reopens, or cancels a record. Cross-BUYER changes preserve it and audit the actual actor.
- All active BUYERs can view and mutate bids. Responsibility is filtering only, not authorization; reassignment is permitted for raw open or closed bids, never cancelled bids.
- Raw states are `open`, `closed`, and `cancelled`; raw open becomes effectively closed when the server-time deadline passes. Details are editable only while effective-open, and reopen requires a null or future deadline.
- Cancellation is irreversible in V1. No cron changes raw state. Quotes and award remain unimplemented.
- Browser code uses only the Supabase publishable key.
- Secret and service-role credentials never enter browser code, Vite variables, or the repository.
- The frontend gate mirrors server access for UX but does not replace RLS or server-side authorization.
- An approved BUYER may take over or modify another BUYER's bid only through server-authorized policy. `created_by` remains immutable, and the actual actor plus any responsible-BUYER reassignment are retained in audit history. Exact permitted bid states, assignment model, quote interaction, and deadline behavior must be decided before the bid-schema PR. This documentation PR does not implement cross-takeover.
