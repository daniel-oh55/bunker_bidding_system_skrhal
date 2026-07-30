# Architecture

## Current shape

- Browser app: React + Vite + TypeScript
- Supabase access: client library dependency and environment placeholders only
- Legacy reference: static Firebase prototype under `legacy/firebase-prototype/`

## Planned direction

- browser code uses only the Supabase publishable key
- secret and service-role credentials never enter browser code, Vite variables, or the repository
- elevated authorization decisions move to PostgreSQL policies and server-side functions without trusting `user_metadata` or unverified client claims
- access checks immediately reject suspended or inactive users
- deadlines use server time, and quote creation or modification after close is rejected server-side
- close, reopen, award, and cancel are server-side transactional operations
- immutable creation identity is stored in `created_by`, separately from the actor performing later update, close, reopen, award, or cancel operations

## Planned access contracts

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.

These are future implementation contracts only; no schema, RLS, Auth UI, or transactional server operations are implemented in this foundation PR.

## Foundation boundaries

- no active Firebase runtime usage
- no SQL migrations yet
- no linked Supabase project yet
- no production deployment changes in this PR
