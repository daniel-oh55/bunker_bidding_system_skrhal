# AGENTS

## Intent

This repository is set up so AI coding agents can work on narrowly scoped PRs without drifting into unrelated product or deployment work.

## Working agreement

- One PR should have one clear purpose.
- Preserve `legacy/firebase-prototype/` as read-only reference material.
- Do not import legacy Firebase code into the active application.
- Do not add real secrets, project IDs beyond legacy references, or service credentials.
- Do not link a remote Supabase project, deploy, or commit actual operational data.
- Keep SQL only in `supabase/migrations/` or `supabase/tests/database/`.
- Prefer small, reviewable changes with matching docs and tests.

## Role split

- Codex: implementation and repository updates
- Claude Code: independent review and risk spotting

## Think before coding

Before implementation, define the protected business invariant; allowed and denied actors; allowed and denied actions; data ownership and organization boundary; database enforcement; application presentation or UX validation; positive tests; denial and bypass tests; concurrency tests when applicable; and stop and recovery conditions.

Authentication is not authorization. `auth.uid()` alone is insufficient when organization membership or business scope is required. Client-supplied role, organization, membership, or metadata is never authoritative.

## Enforcement-layer rules

- Put data integrity in PostgreSQL constraints or transactional functions.
- Put row visibility and mutation authorization in RLS or server-side RPC/functions.
- Application validation is UX-only and cannot be the final authorization boundary.
- Do not implement one rule as independent, potentially conflicting authority in multiple layers.
- Application presentation may mirror a server rule, but must never weaken it.

## Migration states

Keep separate records of the repository migration set, local clean-replay state, and remote applied migration history. A migration merged to `main` or applied to a shared or production environment is never rewritten; use a forward migration. An unmerged, unapplied Draft PR migration may be corrected in that PR. Never infer remote history while the remote project is unconnected. Production migration or rollback requires owner approval; prefer data-preserving forward fixes to destructive rollback.

## Model allocation

- Codex implements the assigned single PR; Claude Code reviews security-sensitive work.
- Use medium or lower reasoning for document, configuration, or small UI work.
- Use high reasoning and independent review for Auth, membership, RLS, `SECURITY DEFINER`, audit, deadline, lifecycle transition, or concurrency work.
- After corrective commits, use focused delta reviews instead of repeating the entire analysis.

## Required Task Card

Use [docs/AI_TASK_CARD_TEMPLATE.md](docs/AI_TASK_CARD_TEMPLATE.md) for implementation work.

## Required Review Report

Use [docs/AI_REVIEW_TEMPLATE.md](docs/AI_REVIEW_TEMPLATE.md) for review work.

## Required checks

Before handoff, run:

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
git diff --check
npm run db:start
npm run db:reset
npm run db:test
npm run db:stop
```

The full audit is classification and reporting. Production high-or-critical findings and any full-tree critical finding are hard gates. The known ESLint development-only high findings may be reported without failing this PR while they remain confined to that path and have no concrete impact on secrets, CI execution, or production build output. Docker is required for the local database commands; GitHub CI remains the database gate when it is unavailable. Do not run `npm audit fix --force` or perform an ESLint major upgrade in this PR.
