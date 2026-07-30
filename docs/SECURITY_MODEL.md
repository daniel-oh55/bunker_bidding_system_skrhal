# Security Model

## Core rules

- No real secrets are stored in the repository.
- Browser code uses only the Supabase publishable key.
- Secret and service-role credentials never enter browser code, Vite variables, or the repository.
- Authorization never trusts `user_metadata` or other unverified client claims.
- Suspended or inactive users immediately lose access.
- Verified membership in an approved organization is the basis for TRADER access decisions.

## Planned access model

- `buyer_admin`
- `buyer_operator`
- `trader`

## Planned enforcement

- public signup remains disallowed
- approved BUYER accounts may number three or more
- every approved BUYER can see all bids and all quotes
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope
- `created_by` is immutable and remains separate from the actor performing update, close, reopen, award, or cancel operations
- deadlines use server time
- quote creation and modification after close are rejected server-side
- close, reopen, award, and cancel are server-side transactional operations

These rules are fixed future contracts. This foundation PR does not yet implement Auth UI, schema, RLS, or server operations.
