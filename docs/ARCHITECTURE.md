# Architecture

## Current shape

- Browser app: React + Vite + TypeScript
- Supabase access: local CLI migrations, pgTAP tests, and an unlinked local configuration
- Authorization data: private `app_private` PostgreSQL schema with account, organization, and membership tables
- Frontend access coordination: sign-in-only state machine backed by `public.current_access_context()`
- Legacy reference: static Firebase prototype under `legacy/firebase-prototype/`

## Implemented authorization baseline

- Auth user creation provisions an inactive private account only; it never grants membership or active access.
- `public.current_access_context()` derives all context from current database rows and fails closed unless account, organization, and membership are active.
- The browser uses a publishable key only, hydrates the session, and renders the minimal authorized shell only when the RPC returns at least one context.
- Auth changes trigger context revalidation, all returned memberships are preserved, and obsolete async results cannot restore access after sign-out.
- The browser does not receive direct access to private authorization tables.
- The loopback-only integration harness uses elevated local access only to prepare and delete fixtures. Its sign-in and RPC assertions use the normal publishable client.
- Bid records, fuel items, and audit events are private RLS-enabled tables. Public bid RPCs verify the selected active BUYER membership server-side and use row locks plus revisions for every non-create mutation.
- Audit events are append-only and contain server-generated before/after snapshots, actor membership/organization/role snapshots, and the resulting revision.

## Planned direction

- browser code uses only the Supabase publishable key
- secret and service-role credentials never enter browser code, Vite variables, or the repository
- elevated authorization decisions move to PostgreSQL policies and server-side functions without trusting `user_metadata` or unverified client claims
- access checks immediately reject suspended or inactive users
- deadlines use server time, and quote creation or modification after close is rejected server-side
- close, reopen, award, and cancel are server-side transactional operations
- immutable creation identity is stored in `created_by`, separately from the actor performing later update, close, reopen, award, or cancel operations
- PostgreSQL constraints or transactional functions are authoritative for data invariants.
- RLS or server-side RPC/functions are authoritative for row and operation authorization.
- Application validation mirrors server rules only for UX.
- Realtime is limited to necessary bid and quote change notifications; it is not a general authorization mechanism.

## Planned access contracts

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.

The bid backend is implemented without a frontend workflow. Raw states are `open`, `closed`, and `cancelled`; raw open becomes effectively closed at a passed server-time deadline without a cron. Quotes, award, signup, invitation, provisioning, password-reset, and admin workflows remain unimplemented. The frontend gate is UX/state coordination and is not a substitute for RLS or server functions.

## Foundation boundaries

- no active Firebase runtime usage
- local SQL migrations and database tests are permitted only in their dedicated Supabase directories
- no linked Supabase project yet
- no production deployment or committed operational data
