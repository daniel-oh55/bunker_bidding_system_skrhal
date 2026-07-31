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
- No remote Supabase project is linked and no real operational data is committed.

## Future enforcement

- public signup remains disallowed
- approved BUYER accounts may number three or more
- every approved BUYER can see all bids and all quotes
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope
- `created_by` is immutable and remains separate from the actor performing update, close, reopen, award, or cancel operations
- deadlines use server time
- quote creation and modification after close are rejected server-side
- close, reopen, award, and cancel are server-side transactional operations
- Cross-BUYER takeover must be authorized server-side and audited; it must not rewrite `created_by`.
- Privilege tests may use elevated fixture setup, but allowed and denied behavior must run under the target caller role.

These rules are fixed future contracts. Bid RLS, frontend Auth UI, invitations, administration, bids, quotes, audits, deadlines, and lifecycle server operations are not yet implemented.
