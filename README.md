# SKRHAL Bunker Bidding

This repository now hosts the Supabase V2 foundation for the SKRHAL bunker bidding rebuild.

The current scope is intentionally limited to:

- preserving the legacy Firebase prototype under `legacy/firebase-prototype/`
- establishing a React + Vite + TypeScript application shell
- preparing Supabase client wiring with environment placeholders only
- adding CI, test, lint, typecheck, and boundary guardrails

Out of scope in this foundation PR:

- production authentication
- database schema, migrations, or RLS implementation
- buyer or trader workflow UI migration
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
```

## Repository layout

- `src/`: Vite application shell
- `legacy/firebase-prototype/`: preserved Firebase reference implementation
- `supabase/config.toml`: local Supabase CLI placeholder config
- `scripts/check-foundation-boundaries.mjs`: fail-closed boundary checker
- `docs/`: product, architecture, security, and review guidance

## Security notes

- No real Supabase credentials belong in this repository.
- Browser code uses only an empty publishable-key placeholder in this phase.
- Secret and service-role credentials must never enter browser code, Vite variables, or the repository.
- Authorization is planned around organization membership and server-enforced policies in PostgreSQL/RLS, not `user_metadata`.

## Dependency audit policy

- The full audit is used for classification and reporting.
- Any critical vulnerability in the full dependency tree is a hard gate.
- High or critical production dependency findings are a hard gate.
- The known `GHSA-mh99-v99m-4gvg` high findings remain confined to ESLint development-only transitive dependencies, so they are reported and allowed to continue in this PR.
- Do not run `npm audit fix --force`.
- Do not upgrade ESLint to a new major version in this PR.
