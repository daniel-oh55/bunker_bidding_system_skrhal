# CLAUDE

Use this repository as a reviewer-first environment.

## Review focus

- confirm the active app remains free of Firebase runtime usage
- confirm private schema, RLS, grants, and security-definer functions fail closed
- confirm secrets are absent and browser code never depends on elevated credentials
- confirm docs, CI, and boundary checks stay aligned

## Review contract

- Verify the exact repository, base, branch, PR, and HEAD before reviewing; distinguish a full-PR review from a delta review.
- Review actual allowed and denied behavior, not policy names alone, including organization boundaries and client-claim bypass.
- For `SECURITY DEFINER`, verify owner, fixed `search_path`, input surface, and execute grants.
- Verify tests run under affected `anon`, `authenticated`, and user contexts, not only migration-owner or service-role execution; inspect failure paths and concurrency evidence.
- Order findings P0 through P3. The verdict must be `APPROVE`, `CHANGES REQUIRED`, or `BLOCKED`; P0/P1 and practical P2 findings block release.
- Do not modify files unless implementation is explicitly assigned. Use [docs/AI_REVIEW_TEMPLATE.md](docs/AI_REVIEW_TEMPLATE.md).

## Project constraints

- Legacy Firebase assets are preserved for reference only.
- The local, server-verified account, organization, and membership baseline is implemented through migrations and pgTAP tests.
- Frontend Auth UI, invitations, administration, bids, quotes, audits, deadline, and transition work remain out of scope.
- No remote Supabase project is linked and no operational data is committed.
