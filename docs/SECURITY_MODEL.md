# Security Model

## Core rules

- No real secrets are stored in the repository.
- Browser code uses only the Supabase publishable key.
- Secret and service-role credentials never enter browser code, Vite variables, or the repository.
- Authorization never trusts `user_metadata` or other unverified client claims.
- Suspended or inactive users immediately lose access.
- Verified membership in an active organization is the basis for current access decisions.
- Authentication alone never grants business authorization, and application filtering is not an authorization boundary.

## Implemented access baseline

- `buyer_admin`
- `buyer_operator`
- `trader`

- Account, organization, and membership status are evaluated in PostgreSQL, not from JWT metadata.
- Private authorization tables live in the non-exposed `app_private` schema with RLS enabled and direct `anon`/`authenticated` table privileges revoked.
- `public.current_access_context()` is executable only by `authenticated` callers and returns only the caller's active memberships through security-definer functions with fixed search paths.
- The sign-in-only frontend calls that RPC after initial session hydration and after Auth state changes. It authorizes the shell only when at least one context is returned.
- The state machine immediately clears contexts on sign-out, ignores stale RPC results, distinguishes zero-context denial from transient errors, and preserves multiple active memberships.
- Missing browser configuration fails closed. The browser client is never partially configured and accepts only the URL and publishable key.
- The loopback-only integration harness isolates elevated local access to fixture preparation and cleanup; its sign-in and RPC checks use the publishable client.
- The frontend creates separate access and bidding adapters from the same publishable client and never exposes the raw client to components. It selects only server-returned memberships, validates every RPC response before rendering, and clears protected data before an authorization-failure recheck. This is UX/state coordination, not the enforcement layer; bid and quote data still require RLS or server-side functions.
- Approved Supabase Production migrations and controlled BUYER/TRADER provisioning are complete. No real operational bidding data has been migrated or is in use; the retained Production record is only a synthetic smoke fixture.
- The bid API accepts a caller-selected membership ID but verifies it against `auth.uid()` and current active account, membership, organization, BUYER kind, and BUYER role rows. JWT metadata, responsibility, and creator identity never authorize access.
- Bid creation identity is trigger-protected. Private bid/audit tables have RLS enabled with direct `anon`/`authenticated` privileges revoked; privileged public RPCs use fixed search paths and minimal authenticated-only execute grants.
- Every successful bid mutation locks the row, compares its expected revision, increments it once, and creates exactly one server-generated append-only audit event.
- TRADER quote authority requires the caller's active account, selected membership, active TRADER organization, and current bid organization-access row. No JWT metadata, quote creator, or client ownership field authorizes an operation.
- Quotes are organization-owned and one-per-bid/organization. Only active same-organization TRADER users can read or update their quote; all active BUYERs can read all retained quotes. Revocation immediately removes TRADER read/write scope.
- Quote prices are validated against the exact bid grade set and totals are calculated server-side. Bid-first locks re-evaluate server-time closure after waiting. Quote identity is trigger-immutable and quote/bid audits are server-generated and append-only.
- Award verifies effective closure, current scope, active TRADER organization, and both revisions within the bid-first transaction. It is terminal in V1 and uses a composite foreign key to prevent cross-bid selection.

## Enforced bidding and scope rules

- Public signup remains disallowed and has no frontend control.
- approved BUYER accounts may number three or more
- every approved BUYER can see all bids and all quotes
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.
- `created_by` is immutable and remains separate from the actor performing update, close, reopen, award, or cancel operations
- Deadlines use server time.
- Quote creation and modification after close are rejected server-side.
- Close, reopen, award, and cancel are server-side transactional operations.
- Active BUYERs may perform cross-BUYER changes through the server RPCs; those changes never rewrite `created_by` and audit the actual actor. Responsibility is a visibility filter, not authority.
- Privilege tests may use elevated fixture setup, but allowed and denied behavior run under the target caller role.

The integrated frontend workspace does not grant authority and does not request competitor data from a TRADER context. It uses manual refresh and post-mutation reload; Realtime, invitations, password reset, and administration/provisioning flows and UI remain unimplemented. Trusted organization display labels in membership context remain follow-up work. The canonical Vercel Production deployment exists; no real operational bidding data has been migrated or is in use.
