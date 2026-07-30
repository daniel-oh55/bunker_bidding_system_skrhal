# Security Model

## Core rules

- No real secrets are stored in the repository.
- Supabase service-role credentials never belong in frontend code.
- Authorization will not rely on `user_metadata` as the source of truth.
- Organization membership is the basis for access decisions.

## Planned access model

- `buyer_admin`
- `buyer_operator`
- `trader`

## Planned enforcement

- public signup remains disallowed
- buyers can review organization-scoped bidding activity
- traders are limited to their own organization context
- submission deadlines, close logic, and sensitive write paths are enforced with PostgreSQL, RLS, and server-side transactional logic in later PRs
- quote edits and audit records are preserved server-side
