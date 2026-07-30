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
- Access is based on verified membership, not unaudited client claims.
- Traders will be restricted to their own organization context.
- Buyers will be able to review bids and organization-scoped activity.
- Deadline closing, quote submission sequencing, and auditability are intended to be enforced server-side.
- Service-role credentials must never be exposed to frontend code.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
