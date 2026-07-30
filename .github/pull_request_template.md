## Summary

- scope:
- excluded scope:

## Validation

- [ ] `npm ci`
- [ ] `npm audit --json` reviewed for full-tree classification and reporting
- [ ] `npm audit --audit-level=critical` passed as the critical hard gate
- [ ] `npm audit --omit=dev --audit-level=high` passed as the production high+ hard gate
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test -- --run`
- [ ] `npm run build`
- [ ] `npm run check:foundation`
- [ ] `git diff --check`

## Security notes

- [ ] no real secrets added
- [ ] no secret or service-role credentials in browser code, Vite variables, or the repository
- [ ] no active Firebase runtime code outside `legacy/`

## Dependency policy

- [ ] known ESLint development-only high findings were reported and remain confined to the known path
- [ ] no `npm audit fix --force`
- [ ] no ESLint major upgrade

## Legacy preservation

- [ ] Firebase prototype preserved under `legacy/firebase-prototype/`
