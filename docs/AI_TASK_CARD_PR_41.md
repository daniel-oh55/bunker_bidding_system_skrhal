# AI Task Card — PR #41 Operational Parser Production Reconciliation

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `c301680cc79d5da81f9da370cc020a802da3925d`
- Working branch: `docs/pr-41-reconcile-operational-parser-production`
- Target PR and expected HEAD: Draft PR #41 against `main`; one documentation commit preferred
- Working tree status: clean at preflight; no merge, rebase, or cherry-pick in progress; no open PR

## Current migration state

- Repository migrations: eleven existing migrations; this task adds, removes, or changes none
- Local clean-replay status: not required because this task changes no executable, configuration, SQL, migration, RPC, RLS, or database-test artifact
- Remote applied status: not queried or modified; the canonical repository documentation records all eleven migrations as applied, and this task does not infer any additional migration history

## Single purpose

Reconcile the canonical repository documentation with the already-completed Production rollout and sanitized post-deployment smoke of the operational `//SPOT//` parser compatibility, without changing any executable artifact or remote system.

## Protected business invariant

The Production smoke result remains a bounded, normalized, review-only pending mail-intake candidate. It is not a bid or real operational bidding record and grants no authority. Intake-to-bid conversion and automatic bid creation remain absent; the existing explicit server-authorized bid creation path remains the sole creation authority. Documentation must contain only sanitized structural facts and no real operational mail content or identity.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Documentation maintainer | Exact base SHA, clean tree, no open PR | Canonical repository documents and supplied verified facts | This task card | Two canonical status statements | None | Sanitized documentation-only reconciliation |
| Active approved BUYER | Existing server-verified authorization | Existing pending queue view | Bid only through the unchanged explicit Create bid action/RPC | Existing review/dismiss actions only | Existing authorized transitions only | Operational candidate remains review-only and pending until an authorized human action |
| Gmail connector | Existing dedicated trigger-header authorization and scheduled polling | Existing bounded eligible mail input | Existing normalized queue ingress only | Existing cursor flow only | None added by this task | No behavior or authority change |
| TRADER, anonymous, or unauthorized caller | Any | No new access | No bid or intake creation | None | None | Existing denial boundaries remain unchanged |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Documentation-only reconciliation | No schema or executable change | Unchanged | Unchanged | Unchanged |
| Pending intake is not a bid | Existing database constraints unchanged | Existing policies unchanged | Existing ingest and explicit bid-creation boundaries unchanged | Review-only queue presentation unchanged |
| Sanitized-only Production facts | No operational data added | Not applicable | No remote calls | Documentation contains structural descriptions only |
| No replay or cursor mutation | No migration or data change | Unchanged | No connector invocation, cursor reset, rescan, or queue mutation | Not applicable |

## Allowed files

1. `PROJECT_STATE.md`
2. `docs/PRODUCT_AND_SCOPE.md`
3. `docs/AI_TASK_CARD_PR_41.md`

## Forbidden scope

Do not modify application or parser code, Edge Functions, configuration, migrations, RPC, RLS, Auth, membership, Cron, Vault, secrets, Vercel, Supabase, Gmail, cursor state, queue rows, or legacy Firebase. Do not deploy, invoke Gmail or the connector, query or modify Production, reset a cursor, rescan history, reprocess retained queue rows, add intake-to-bid conversion or automatic bid creation, change excluded scope, or commit any real company name, vessel name, voyage, mailbox identity, message ID, subject, port or terminal name, fuel amount, timestamp, queue ID, or other operational mail content.

The only authorized remote writes are pushing this documentation branch and opening its Draft GitHub PR. They must not write to any application, Production, Gmail, Supabase, Vercel, or other operational service.

## Database and migration plan

No database, SQL, migration, RPC, RLS, Auth, data, local Supabase, or remote-state work is required or authorized. Repository migration files and recorded migration history remain unchanged.

## Verified Production facts

The following facts were supplied as already verified outside this documentation task and are recorded only in sanitized structural form:

1. PR #40 was squash-merged into the canonical `main` baseline.
2. The Production `gmail-mail-intake` Edge Function was redeployed from the merged PR #40 parser baseline and remained active.
3. Existing custom server-to-server trigger-header authorization remained unchanged, and intentional `verify_jwt = false` behavior remained unchanged.
4. No cursor reset, historical rescan, queue reprocessing, migration, RPC, RLS, Auth, Cron, Vault, secret, or Vercel change accompanied the deployment.
5. Existing pre-deployment pending queue rows were not reparsed.
6. One new exact-marker operational mail received after deployment passed through the existing automatic five-minute polling path.
7. Its new queue candidate contained non-null normalized vessel, port, delivery-window, and supported-fuel quantity candidates.
8. The previous false supported-grade invalid-quantity warnings were absent.
9. The result remained review-only and pending, and no bid was created automatically.
10. No real operational content or identifying value is recorded in repository documentation.

## Test scenarios

- Positive, denial, and cross-organization cases: verify both canonical documents state the sanitized successful scheduled-polling result and preserve review-only, no-bid behavior; authorization and organization behavior are unchanged because no executable artifact changes.
- Client-claim bypass, inactive/suspended, and privilege cases: not applicable to this documentation-only change; existing server enforcement and denial contracts remain unchanged and must not be restated as new behavior.
- Privacy and scope cases: verify no real operational identity, content, quantities, timestamps, or identifiers appear; verify retained pending candidates are not described as bidding records; verify all existing mail-intake exclusions remain unchanged.
- Concurrency cases where relevant: not applicable; no parser, connector, queue, cursor, transaction, or database behavior changes.

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
git diff --name-only origin/main...HEAD
```

The final diff name list must contain exactly the three allowed files. No local Supabase stack is required because this PR changes no executable or database artifact. Never run `npm audit fix --force`.

## Stop conditions

Stop and preserve the working tree if `origin/main` is not the exact expected SHA, an open overlapping PR exists, the working tree is dirty before editing, a merge/rebase/cherry-pick is in progress, a file outside the allowlist is needed, any Production fact would require guessing, real operational content would need to be committed, an executable or configuration change appears necessary, or an audit hard gate fails. Production high-or-critical findings and any full-tree critical finding are hard gates.

## Git and PR rules

Prefer one commit named `docs: reconcile operational parser production state`. Push only `docs/pr-41-reconcile-operational-parser-production` and open a Draft PR against `main`. Do not mark Ready, merge, deploy, change Production, or clean remote branches. If GitHub assigns a number other than #41, report it.

## Completion report

Record preflight; starting `main` SHA; branch; final HEAD; commit SHA/message; exact changed files; exact Production-state wording; unchanged exclusions; validation and audit results; GitHub CI and any automatically created Vercel status; Draft PR URL/state; deviations or unresolved items; and explicit confirmation that no Production, Gmail, cursor, queue, Cron, Vault, secret, Vercel, or Supabase mutation occurred.

## Recommended model and reasoning

Medium or lower reasoning is appropriate because this task changes documentation only and introduces no authorization, migration, deadline, lifecycle, or concurrency behavior.

## Owner approval point

Owner review is required before the Draft PR may be marked Ready or merged. No deployment or operational mutation is part of this task.
