# AI Task Card: PR #26 BUYER Workspace UX/UI Refinement

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main@2803c7496b083f91c7eb35bdf71e06cc68a0d73f`
- Working branch: `feat/pr-26-buyer-workspace-ux`
- Target PR and expected HEAD: PR #26, a single presentation-only commit on the exact base
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or conflicting open PR

## Current migration state

- Repository migrations: unchanged by this PR
- Local clean-replay status: not required solely for this BUYER UI PR
- Remote applied status: not inferred; no remote Supabase project is linked or changed

## Single purpose

Refine the existing BUYER workspace information hierarchy, responsive presentation, and accessibility on top of the PR #25 shared UI foundation without changing application behavior or server contracts.

## Protected business invariant

- Three or more approved BUYERs are supported, and every approved BUYER can see all bids and quotes.
- The three server view values remain exactly `all`, `created_by_me`, and `responsible_buyer`; responsible BUYER is filtering only, never authorization.
- `created_by` remains immutable, while cross-BUYER mutations remain server-authorized and actor-audited.
- Server effective status and deadline rules remain authoritative; the first quote freezes commercial bid terms.
- Manual Refresh and post-mutation authoritative reload remain, while Realtime remains best-effort invalidation only.
- Authorization failure clears protected state and rechecks access.
- Award and revoke confirmations stay bound to the exact server data, and stale confirmations are invalidated.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Approved BUYER | Server-approved, active access | All bids and all quotes, including BUYER-filtered views | Existing `BidInput` flow | Existing server-authorized bid/reassignment/access calls | Existing close/reopen/cancel/award calls | Presentation improves; request arguments and authorization remain unchanged |
| Approved BUYER acting across BUYER ownership | Server authorizes the exact action | Same visible workspace data | Existing behavior | Existing actor-audited behavior | Existing lifecycle behavior | Responsible BUYER never becomes an authorization boundary |
| Unapproved or authorization-failed actor | Server denies or access recheck fails | No retained protected state | Denied | Denied | Denied | Existing protected-state clearing and access recheck remain intact |
| TRADER or other actor | Outside this workspace scope | No new access | No new action | No new action | No new action | No authorization or product-scope expansion |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BUYER visibility and mutation authorization | Unchanged | Unchanged | Existing server authority preserved | Labels, grouping, and responsive presentation only |
| Effective status, deadline, lifecycle, and award rules | Unchanged | Unchanged | Existing effective state and mutation behavior preserved | Display existing effective/raw values without deriving authority |
| Responsible BUYER | Unchanged | Unchanged | Existing filtering semantics preserved | Server-returned active BUYER selection gates the existing filter request |
| Bid and quote integrity | Unchanged | Unchanged | Existing revisions, signatures, ordering, and confirmations preserved | Dense cards and stronger total emphasis only |

## Allowed files

- `docs/AI_TASK_CARD_PR_26.md`
- `PROJECT_STATE.md`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/bidding/buyer-bid-detail.tsx`
- `src/bidding/buyer-bid-detail.test.tsx`
- `src/bidding/bid-form.tsx`
- `src/bidding/bid-form.test.tsx`
- `src/styles.css`

## Forbidden scope

- No changes to Auth, Realtime, RPC calls or arguments, server data contracts, business rules, lifecycle conditions, confirmation bindings, Production configuration, Supabase, dependencies, invitations, or admin behavior.
- Do not modify `src/App.tsx`, `src/auth/**`, `src/realtime/**`, `src/bidding/context-workspace.tsx`, `src/bidding/trader-workspace.tsx`, `src/bidding/bidding-client.ts`, `src/bidding/types.ts`, `src/ui/**`, `supabase/**`, `package.json`, `package-lock.json`, `.github/**`, or `legacy/**`.
- Stop before editing if implementation requires any file outside the allowlist.

## Database and migration plan

No database, migration, RLS, RPC, or server-function changes. Application presentation may mirror authoritative server values but cannot weaken or replace their enforcement.

## Test scenarios

- Positive: human-readable radio labels map to the exact existing server views; a selected bid has a non-color accessible selected state; all required list and detail information remains visible.
- Form preservation: failed create retains every draft field; successful create clears every draft field; existing responsible-BUYER and duplicate-fuel behavior remains.
- Detail lifecycle: all four disclosure sections remain, with unchanged state-dependent default-open rules.
- Denial and bypass: existing authorization failure, stale-request, lifecycle, confirmation-binding, and draft-preservation assertions remain intact.
- Mutation safety: existing update, reassign, close, reopen, cancel, grant, revoke, and award arguments and pending guards remain unchanged.
- Quote comparison: existing awarded-first, total ordering, tie-breaking, and visible operational fields remain unchanged.
- Responsive/accessibility: usable from 320px, no intentional horizontal overflow, keyboard controls and focus-visible styling retained.
- Concurrency: no behavior change; existing revision/conflict handling and authoritative reload paths remain the gate.

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

Stop for a dirty tree at preflight, origin mismatch, exact-base mismatch, diverged or local-only `main` history, an in-progress Git operation, a conflicting open PR, a required edit outside the allowlist, a canonical-contract conflict, a production high-or-critical audit finding, a full-tree critical finding, or validation that exposes a behavior change needing forbidden-scope work.

## Git and PR rules

- Preferred commit and PR title: `feat: refine buyer workspace UX`
- Open a Draft PR against `main`; do not mark Ready, merge, deploy, modify Production, or delete branches.
- Keep this as one narrowly scoped PR and stop after Draft PR creation and exact-head status reporting.

## Completion report

- Preflight: origin matched; `origin/main` matched the exact required SHA; no dirty tree, Git operation, local-only `main` commit, or conflicting open PR was present.
- Main synchronization: local `main` fast-forwarded safely from `2805a2cec81567329ce2f623296236954cea571a` to the exact starting SHA `2803c7496b083f91c7eb35bdf71e06cc68a0d73f`.
- Implementation: human-readable server-backed filters, authoritative-list summary counts, dense accessible selected bid cards, clearer collapsed create form, StatusBadge detail overview, and buyer-specific operation/quote/access/audit presentation.
- Behavior boundary: no RPC, Auth, Realtime, lifecycle, ordering, request argument, confirmation-binding, authorization-clearing, or authoritative-reload behavior changed.
- Validation before commit: focused tests 31/31; full tests 210/210; lint, typecheck, build, foundation boundary check, and diff check passed.
- Audit classification: full tree 0 vulnerabilities; critical gate passed; production high gate passed with 0 vulnerabilities.
- GitHub completion: final HEAD, exact changed-file list, Draft PR URL, and exact-head CI/Vercel status are recorded in the PR and handoff because those values are created after this card is committed.
- Deviations: local Supabase replay omitted as expressly allowed for this UI-only PR; no deploy or Production change.

## Recommended model and reasoning

GPT-5.6 Sol / Medium.

## Owner approval point

The owner must review and approve the Draft PR before it is marked Ready, merged, deployed, or used for any Production change.
