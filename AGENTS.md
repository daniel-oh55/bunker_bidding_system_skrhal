# AGENTS

## Intent

This repository is set up so AI coding agents can work on narrowly scoped PRs without drifting into product, schema, or deployment work.

## Working agreement

- One PR should have one clear purpose.
- Preserve `legacy/firebase-prototype/` as read-only reference material.
- Do not import legacy Firebase code into the active application.
- Do not add real secrets, project IDs beyond legacy references, or service credentials.
- Prefer small, reviewable changes with matching docs and tests.

## Role split

- Codex: implementation and repository updates
- Claude Code: independent review and risk spotting

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
```

The full audit is classification and reporting. Production high-or-critical findings and any full-tree critical finding are hard gates. The known ESLint development-only high findings may be reported without failing this PR while they remain confined to that path and have no concrete impact on secrets, CI execution, or production build output. Do not run `npm audit fix --force` or perform an ESLint major upgrade in this PR.
