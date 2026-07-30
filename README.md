# SKRHAL Bunker Bidding

This repository hosts the Supabase V2 authorization baseline for the SKRHAL bunker bidding rebuild. The PR #1 application foundation is complete.

The current scope is intentionally limited to:

- preserving the legacy Firebase prototype under `legacy/firebase-prototype/`
- establishing a React + Vite + TypeScript application shell
- running local Supabase migration replay and pgTAP database tests
- maintaining private account, organization, and membership authorization data
- deriving current access through a server-verified authenticated RPC
- adding CI, test, lint, typecheck, and boundary guardrails

Out of scope in this foundation PR:

- frontend authentication UI, invitations, or admin provisioning
- buyer or trader workflow UI migration
- bids, quotes, audits, deadline policies, or lifecycle transitions
- secret registration, Supabase project linking, or deployment

## Local commands

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run check:foundation
npm run db:start
npm run db:reset
npm run db:test
npm run db:stop
```

## Repository layout

- `src/`: Vite application shell
- `legacy/firebase-prototype/`: preserved Firebase reference implementation
- `supabase/`: local Supabase configuration, migrations, and pgTAP database tests
- `scripts/check-foundation-boundaries.mjs`: fail-closed boundary checker
- `docs/`: product, architecture, security, and review guidance

## Security notes

- No real Supabase credentials belong in this repository.
- Browser code uses only an empty publishable-key placeholder in this phase.
- Secret and service-role credentials must never enter browser code, Vite variables, or the repository.
- Authorization uses server-verified account, organization, and membership rows in PostgreSQL/RLS, never `user_metadata`.
- No remote Supabase project is linked, and no real user, organization, or bidding data is committed.

## Dependency audit policy

- The full audit is used for classification and reporting.
- Any critical vulnerability in the full dependency tree is a hard gate.
- High or critical production dependency findings are a hard gate.
- The known `GHSA-mh99-v99m-4gvg` high findings remain confined to ESLint development-only transitive dependencies, so they are reported and allowed to continue in this PR.
- Do not run `npm audit fix --force`.
- Do not upgrade ESLint to a new major version in this PR.
