# AI Task Card Template

## Summary

State the narrow goal of the PR in one or two sentences.

## Included scope

- item

## Excluded scope

- item

## Security checks

- no secrets added
- no legacy Firebase imports added
- no unauthorized boundary expansion

## Validation

- `npm ci`
- `npm audit --json` (full-tree classification and reporting)
- `npm audit --audit-level=critical` (critical hard gate)
- `npm audit --omit=dev --audit-level=high` (production high+ hard gate)
- `npm run lint`
- `npm run typecheck`
- `npm run test -- --run`
- `npm run build`
- `npm run check:foundation`
- `git diff --check`

Known ESLint development-only high findings are report-and-continue only while the production audit is clean, the full audit has no critical finding, and there is no concrete impact on secrets, CI execution, or production build output. Do not use `npm audit fix --force` or upgrade ESLint to a new major version in this PR.
