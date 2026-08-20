# AI Task Card: PR #27 TRADER Workspace UX/UI Refinement

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@f6946762f297366f11935ef455ed1b28a090a589`
- Working branch: `feat/pr-27-trader-workspace-ux`
- Target PR and expected HEAD: PR #27, a single presentation-only commit on the exact base
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, local-only `main` commit, divergence, or conflicting open PR

## Current migration state

- Repository migrations: unchanged by this PR
- Local clean-replay status: not required solely for this TRADER UI PR
- Remote applied status: not inferred; no remote Supabase project is linked or changed

## Single purpose

Refine the existing TRADER workspace information hierarchy, quote-entry UX, terminal-result presentation, responsiveness, and accessibility without changing quote, authorization, deadline, RPC, Realtime, or authoritative-reload behavior.

## Protected business invariant

- TRADER access requires server-verified active organization membership and explicitly scoped bids.
- TRADERs never receive competitor scope or quote data.
- One organization owns one quote, and active members of that organization collaborate on it.
- Effective status, deadlines, quote acceptance, and server totals remain authoritative.
- Quote create and update remain rejected server-side after effective close.
- Manual Refresh, post-mutation reload, and Realtime invalidation retain the existing authoritative reload path.
- Authorization failure and scope revocation immediately remove protected TRADER data and access.
- Browser calculations remain non-authoritative estimates and are never submitted as totals.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active TRADER organization member | Server verifies active membership and explicit bid scope | Existing `listTraderBids` and `listMyQuotes` feeds only | Existing organization-owned quote flow | Existing quote ID/revision flow | None in this PR | Presentation improves; request arguments and server authority remain unchanged |
| Collaborating member of the same organization | Same verified organization and bid scope | Same own-organization quote | Existing behavior | Existing revision-checked behavior | None | Authoritative quote revision replaces stale local draft values |
| Unapproved, revoked, inactive, or authorization-failed actor | Server denies or access recheck fails | No retained protected data | Denied | Denied | Denied | Existing fail-closed clearing and access revalidation remain intact |
| Competitor organization or out-of-scope TRADER | No matching active scope | No competitor or out-of-scope data | Denied | Denied | None | No new visibility, inference, or comparison is introduced |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Membership, organization, and per-bid visibility | Unchanged | Unchanged | Existing server verification preserved | Render only the two authoritative loaded feeds |
| One organization, one quote and revision-safe collaboration | Unchanged | Unchanged | Existing create/update ownership and revision checks preserved | Existing React card key resets stale drafts on authoritative revision changes |
| Effective status, deadline, and terminal rules | Unchanged | Unchanged | Existing server authority preserved | Display server-provided effective state with text as well as color |
| Quote inputs and totals | Unchanged | Unchanged | Existing exact `QuoteInput` and authoritative total preserved | Show requested quantities, editable prices, non-authoritative estimate, and distinct server total |

## Allowed files

- `docs/AI_TASK_CARD_PR_27.md`
- `PROJECT_STATE.md`
- `src/bidding/trader-workspace.tsx`
- `src/bidding/trader-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

- No changes to authorization, Auth, membership, bid scope, RPC behavior or arguments, quote business rules, deadlines, Realtime, authoritative reloads, competitor isolation, server data contracts, Production configuration, Supabase, dependencies, invitations, or administration.
- No new filter, search, sort, countdown, competitor comparison, quote withdrawal, deployment, or Production work.
- Do not modify `src/App.tsx`, `src/auth/**`, `src/realtime/**`, `src/ui/**`, `src/bidding/context-workspace.tsx`, `src/bidding/buyer-workspace.tsx`, `src/bidding/buyer-bid-detail.tsx`, `src/bidding/bid-form.tsx`, `src/bidding/bidding-client.ts`, `src/bidding/types.ts`, `supabase/**`, `package.json`, `package-lock.json`, `.github/**`, or `legacy/**`.
- Stop before editing if implementation requires any file outside the allowlist.

## Frozen logic

- Preserve behavior and arguments for `listTraderBids`, `listMyQuotes`, `createQuote`, and `updateQuote`.
- Preserve `load()`, `authorizationFailure()`, `invalidateOperations()`, `save()`, `TraderBidCard` submit behavior, `editable`, `canSave`, preview calculation, `terminalMessage`, and the `TraderBidCard` React key.
- Preserve two initial feeds, fail-closed clearing, stale-operation invalidation, one authoritative reload for `40001` / `55000` / `P0002`, post-success reload, `reloadVersion`, duplicate-submission protection, organization collaboration, fuel-item order, and competitor isolation.

## Database and migration plan

No database, migration, RLS, RPC, or server-function changes. PostgreSQL and server RPCs remain the final integrity and authorization boundaries; application changes are presentation and UX validation only.

## Test scenarios

- Positive: summary distinguishes open, own-quoted, and accessible counts from the loaded feeds; card hierarchy retains vessel/voyage, port, effective status, deadline, delivery window, fuels, and quantities.
- Quote states: an open no-quote card is explicit; an existing own quote shows its revision and authoritative server total; the estimate is visibly non-authoritative and distinct.
- Payload safety: create keeps bid ID and exact fuel-item array order; update keeps the current quote ID/revision; neither submits total or identity fields.
- Collaboration: an authoritative quote revision refresh remounts the keyed card and replaces stale draft values.
- Terminal states: selected, not-selected, awarded-without-own-quote, cancelled, and other closed messages remain semantically distinct; own quotes are read-only and no-quote states remain neutral.
- Denial and bypass: `42501` and primary protocol failures still clear protected data; stale-request, reload, and duplicate-submission assertions remain intact.
- Responsive/accessibility: usable from 320px without intentional horizontal overflow; labels, keyboard operation, focus-visible styles, status text, and terminal announcements remain.
- Concurrency: no behavior change; existing revision conflict and authoritative reload paths remain the gate.

## Validation commands

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
git diff --name-only main...HEAD
git status --short
```

The production dependency audit at high severity is a hard gate. Full-tree critical findings are a hard gate. Never run `npm audit fix --force`. Local Supabase replay is not required for this presentation-only PR.

## Stop conditions

Stop for a dirty tree at preflight, origin mismatch, exact-base mismatch, diverged or local-only `main` history, an in-progress Git operation, a conflicting open PR, a required edit outside the allowlist, a frozen-logic or canonical-contract conflict, a production high-or-critical audit finding, a full-tree critical finding, or validation that exposes a behavior change needing forbidden-scope work.

## Git and PR rules

- Preferred commit and PR title: `feat: refine trader workspace UX`
- Open a Draft PR against `main`; do not mark Ready, merge, deploy, modify Production, or delete branches.
- Keep this as one narrowly scoped PR and stop after Draft PR creation and exact-head status reporting.

## Completion report

- Preflight: origin matched; `origin/main` matched the exact required SHA; no dirty tree, Git operation, local-only `main` commit, divergence, or conflicting open PR was present.
- Main synchronization: local `main` fast-forwarded safely from `2803c7496b083f91c7eb35bdf71e06cc68a0d73f` to the exact starting SHA `f6946762f297366f11935ef455ed1b28a090a589`.
- Implementation: three authoritative-feed summary metrics; stronger bid and own-quote hierarchy; quantity-aware price rows; explicit non-authoritative estimate and authoritative server total; accessible terminal and read-only quote panels; TRADER-specific responsive styles.
- Behavior boundary: no RPC, Auth, membership, scope, quote rule, deadline, Realtime, request argument, key identity, validation, calculation, terminal semantic, or authoritative-reload behavior changed.
- Validation before commit: focused TRADER tests 19/19; full tests 213/213; lint, typecheck, build, foundation boundary check, and diff check passed.
- Audit classification: full tree 0 vulnerabilities; critical gate passed; production high gate passed with 0 vulnerabilities.
- Browser visual check: unavailable because no browser instance was connected; no substitute browser automation was used. Responsive safeguards were reviewed in scoped CSS and passed build validation.
- GitHub completion: final HEAD, exact changed-file list, Draft PR URL, and exact-head CI/Vercel status are recorded in the PR and handoff because those values are created after this card is committed.
- No deployment, Production change, merge, or branch deletion is authorized.

## Recommended model and reasoning

GPT-5.6 Sol / Medium.

## Owner approval point

The owner must review and approve the Draft PR before it is marked Ready, merged, deployed, or used for any Production change.
