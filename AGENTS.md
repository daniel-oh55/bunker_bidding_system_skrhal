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
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run check:foundation
git diff --check
```
