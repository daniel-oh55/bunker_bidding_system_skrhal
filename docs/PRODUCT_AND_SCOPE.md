# Product And Scope

## Goal

Rebuild the SKRHAL bunker bidding system on a Supabase-backed stack while preserving the existing Firebase prototype only as a reference artifact.

## Foundation PR scope

- create the new application shell
- preserve the legacy prototype
- prepare local tooling, CI, and documentation

## Excluded from this phase

- auth flows
- invitation flows
- organization, deal, or quote tables
- `.msg` or `.eml` migration
- approval and submission business rules
- schema migrations and RLS policies

## Future implementation contracts

These contracts are fixed for later implementation; this foundation PR does not implement them:

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.
- Authorization never trusts `user_metadata` or unverified client claims, and suspended or inactive users immediately lose access.
- `created_by` is immutable and remains distinct from the actor who updates, closes, reopens, awards, or cancels a record.
- Deadlines use server time; quote creation and modification after close are rejected server-side.
- Close, reopen, award, and cancel are server-side transactional operations.
- Browser code uses only the Supabase publishable key.
- Secret and service-role credentials never enter browser code, Vite variables, or the repository.
