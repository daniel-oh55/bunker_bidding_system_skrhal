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
- frontend bid or quote workflow UI, Realtime, quote withdrawal, unaward, or award replacement
- `.msg` or `.eml` migration
- approval and submission business rules
- remote Supabase linking, deployment, or committed user, organization, or bidding data

## Future implementation contracts

These contracts are implemented in the private database/RPC backend; frontend workflows remain out of scope:

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an active organization and an explicit current per-bid organization grant. Quotes are organization-owned, so active same-organization TRADER users may collaborate while competitors cannot see them.
- Authorization never trusts `user_metadata` or unverified client claims, and suspended or inactive users immediately lose access.
- `created_by` is immutable and remains distinct from the active BUYER actor who updates, closes, reopens, or cancels a record. Cross-BUYER changes preserve it and audit the actual actor.
- All active BUYERs can view and mutate bids. Responsibility is filtering only, not authorization; reassignment is permitted for raw open or closed bids, never cancelled bids.
- Raw states are `open`, `closed`, `awarded`, and `cancelled`; raw open becomes effectively closed when the server-time deadline passes. Quote creation/update is rejected after effective closure. Reopen preserves quotes and requires a null or future deadline.
- First quote freezes commercial bid terms and quantities; only a real deadline-only change is permitted while open. Cancellation and award are irreversible in V1. Award is an atomic eligible-quote selection; revocation is an immediate security operation and retains BUYER visibility of the quote.
- Browser code uses only the Supabase publishable key.
- Secret and service-role credentials never enter browser code, Vite variables, or the repository.
- The frontend gate mirrors server access for UX but does not replace RLS or server-side authorization.
- An approved BUYER may take over or modify another BUYER's bid only through server-authorized policy. `created_by` remains immutable, and the actual actor plus any responsible-BUYER reassignment are retained in audit history. Exact permitted bid states, assignment model, quote interaction, and deadline behavior must be decided before the bid-schema PR. This documentation PR does not implement cross-takeover.
