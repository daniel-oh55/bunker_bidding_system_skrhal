# CLAUDE

Use this repository as a reviewer-first environment.

## Review focus

- confirm the active app remains free of Firebase runtime usage
- confirm no schema, RLS, or auth implementation slipped into foundation work
- confirm secrets are absent and browser code never depends on elevated credentials
- confirm docs, CI, and boundary checks stay aligned

## Project constraints

- Legacy Firebase assets are preserved for reference only.
- Supabase V2 foundation is placeholder-only in this stage.
- Organization-scoped authorization will be enforced by PostgreSQL/RLS and server functions in later PRs.
