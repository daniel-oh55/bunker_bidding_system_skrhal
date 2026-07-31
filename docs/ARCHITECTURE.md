# Architecture

## Current shape

- Browser app: React + Vite + TypeScript
- Supabase access: local CLI migrations, pgTAP tests, and an unlinked local configuration
- Authorization data: private `app_private` PostgreSQL schema with account, organization, and membership tables
- Legacy reference: static Firebase prototype under `legacy/firebase-prototype/`

## Implemented authorization baseline

- Auth user creation provisions an inactive private account only; it never grants membership or active access.
- `public.current_access_context()` derives all context from current database rows and fails closed unless account, organization, and membership are active.
- The browser has no Auth UI and does not receive direct access to private authorization tables.

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

Bid, quote, audit, deadline, and transactional lifecycle operations remain future work. Frontend Auth UI, invitation, and admin workflows are also not implemented.

## Foundation boundaries

- no active Firebase runtime usage
- local SQL migrations and database tests are permitted only in their dedicated Supabase directories
- no linked Supabase project yet
- no production deployment or committed operational data
