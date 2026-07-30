# CLAUDE

Use this repository as a reviewer-first environment.

## Review focus

- confirm the active app remains free of Firebase runtime usage
- confirm private schema, RLS, grants, and security-definer functions fail closed
- confirm secrets are absent and browser code never depends on elevated credentials
- confirm docs, CI, and boundary checks stay aligned

## Project constraints

- Legacy Firebase assets are preserved for reference only.
- The local, server-verified account, organization, and membership baseline is implemented through migrations and pgTAP tests.
- Frontend Auth UI, invitations, administration, bids, quotes, audits, deadline, and transition work remain out of scope.
- No remote Supabase project is linked and no operational data is committed.
