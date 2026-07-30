# PROJECT STATE

## Rolling state

- Active branch purpose: establish the Supabase V2 foundation
- Active frontend baseline: React + Vite + TypeScript shell
- Active backend baseline: local Supabase config placeholder only
- Legacy reference location: `legacy/firebase-prototype/`

## Fixed contracts

- Firebase data and accounts are not being migrated.
- Roles are planned as `buyer_admin`, `buyer_operator`, and `trader`.
- Public signup is not allowed.
- Approved BUYER accounts may number three or more.
- Every approved BUYER will be able to see all bids and all quotes, with views for all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access will require verified membership in an approved organization and will be limited to explicitly allowed bid and quote scope.
- Authorization will never trust `user_metadata` or other unverified client claims.
- Suspended or inactive users will immediately lose access.
- `created_by` will be immutable and kept separate from the actor performing update, close, reopen, award, or cancel operations.
- Deadlines will use server time, and quote creation or modification after close will be rejected server-side.
- Close, reopen, award, and cancel will be server-side transactional operations.
- Browser code will use only the Supabase publishable key.
- Secret and service-role credentials will never enter browser code, Vite variables, or the repository.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
