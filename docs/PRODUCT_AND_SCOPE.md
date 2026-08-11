# Product And Scope

## Goal

Rebuild the SKRHAL bunker bidding system on a Supabase-backed stack while preserving the existing Firebase prototype only as a reference artifact.

## Implemented baseline

- The PR #1 application foundation and preserved legacy reference are complete.
- Local Supabase migrations, pgTAP testing, and a CI database-validation job are implemented.
- Private accounts, organizations, memberships, and server-verified current-access context are implemented. The repository RPC exposes a trimmed organization label sourced from the active organization row.
- A sign-in-only frontend boundary exposes a minimal shell only after the server returns active membership context.
- The integrated RPC-only BUYER/TRADER workspace is implemented, including BUYER bid lifecycle and responsibility reassignment, explicit TRADER organization scope, organization-owned quotes, revision locking, terminal award, and append-only audit history.
- Seven reviewed Supabase migrations, including `20260808090000_realtime_workspace_notifications` and the trusted organization-label access-context migration, are applied in Production. The Production private Broadcast authorization foundation is applied; Realtime service is enabled with public channel access disabled, enforcing private channels. Controlled BUYER/TRADER provisioning is complete, and a Production UI smoke confirmed each role displays its trusted server organization label and enters its authorized workspace.
- The canonical Vercel Production deployment exists, and sanitized lifecycle smoke testing is complete using a retained synthetic smoke fixture.
- Existing Auth users can request a self-service password reset. The response is non-enumerating, and a recovery session can only update a password before local sign-out and a new normal sign-in.

## Excluded from this phase

- public signup, invitation, and admin-provisioning flows
- quote withdrawal, unaward, or award replacement
- `.msg` or `.eml` migration
- approval and submission business rules
- migration or use of real operational bidding data

## Implemented business contracts

These contracts are implemented in the private database/RPC backend and surfaced through an integrated RPC-only frontend workspace:

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
- An approved BUYER may take over or modify another BUYER's bid only through server-authorized policy. `created_by` remains immutable, and the actual actor plus any responsible-BUYER reassignment are retained in audit history.

The frontend selects only server-returned memberships, never grants authority, clears protected data on context switch, sign-out, password recovery, or authorization failure, and uses manual refresh plus post-mutation server reload. It consumes private Realtime Broadcast only as best-effort invalidation: one self access topic and one selected-context business topic cause server access revalidation or an authoritative BUYER/TRADER RPC reload, never payload rendering. Membership selectors and chips present the server label as display data only; the old four-field RPC shape uses a shortened neutral organization ID solely for safe frontend-first rollout ordering. Password recovery is limited to existing Auth users and does not grant workspace access; a recovery session must complete its password update and then sign in normally for server-verified membership access. Invitations and administration/provisioning flows and UI remain unimplemented. No real operational bidding data has been migrated or is in use; the retained Production record is only a synthetic smoke fixture.
