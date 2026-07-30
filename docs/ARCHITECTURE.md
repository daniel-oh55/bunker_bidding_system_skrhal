# Architecture

## Current shape

- Browser app: React + Vite + TypeScript
- Supabase access: client library dependency and environment placeholders only
- Legacy reference: static Firebase prototype under `legacy/firebase-prototype/`

## Planned direction

- browser uses anon-key Supabase access only where appropriate
- elevated authorization decisions move to PostgreSQL policies and server-side functions
- audit-sensitive workflow behavior is enforced outside the client

## Foundation boundaries

- no active Firebase runtime usage
- no SQL migrations yet
- no linked Supabase project yet
- no production deployment changes in this PR
