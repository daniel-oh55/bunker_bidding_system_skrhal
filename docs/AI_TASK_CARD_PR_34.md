# AI Task Card — PR #34 Provider-neutral BUYER Mail Intake Queue UI

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@13a8c8866620e81ff40dd6d06f876e0f048fc606`
- Working branch: `feat/pr-34-buyer-mail-intake-queue`
- Target PR and expected HEAD: Draft PR #34 against `main`; final HEAD to be recorded at handoff
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no conflicting open PR

## Current migration state

- Repository migrations: nine canonical migrations, including `20260821070000_mail_intake_foundation` and `20260821100000_mail_intake_ingress_hardening`; unchanged by this frontend-only PR
- Local clean-replay status: previously covered by the reviewed mail-intake backend; no local database work is required because this PR changes no database object
- Remote applied status: owner-verified Production history contains all nine canonical migrations, including both mail-intake versions; this task will not connect to or modify Production

## Single purpose

Expose the existing provider-neutral shared pending mail-intake queue to active BUYER users through the already-reviewed authenticated list and dismiss RPCs, with strict runtime parsing, isolated frontend state, and canonical-state documentation.

## Protected business invariant

Only a server-verified active BUYER membership may list the shared pending queue or irreversibly dismiss an item at its current revision. The browser receives and renders only bounded normalized candidates, never provider/message identity or raw mail data. Queue review and dismissal cannot create, update, populate, or link a bid and cannot change the existing `CreateBidForm`, `createBid`, or Realtime contracts.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active approved BUYER | Authenticated user owns the selected active BUYER membership | Shared pending normalized candidates through list RPC | None | None | Pending to dismissed through expected-revision RPC after target-bound confirmation | Authoritative reload removes the shared item |
| Inactive/suspended/forged BUYER context | Server actor check fails | None | None | None | None | Queue clears immediately and access is revalidated |
| TRADER, anonymous, or service role using browser surface | Not an active BUYER browser context | None through this UI | None | None | None | No queue UI authority or ingest surface |
| Future trusted connector | Outside browser and outside this PR | No list authority | Existing ingest-only RPC outside this UI | None | No dismiss authority | No browser code or credential introduced |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Bounded normalized queue shape | Existing private-table checks | Existing direct-table denial | Existing result composite and RPCs | Strict parsers fail closed before rendering |
| Active BUYER-only shared list/dismiss | Existing membership data constraints | Existing private queue boundary | Existing `require_active_buyer_actor()` calls | Selected membership only; authorization failure clears queue and rechecks |
| One-way revision-safe dismissal | Existing lifecycle consistency | No direct browser mutation | Existing row lock, pending check, and expected revision | Target ID + revision confirmation, then authoritative reload |
| No intake-to-bid conversion | No bid relation or authority fields in intake | Existing separate private data | No conversion RPC; `createBid` unchanged | Review-only copy and no Apply/Create-from-mail action |

## Allowed files

- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_34.md`
- `src/bidding/types.ts`
- `src/bidding/types.test.ts`
- `src/bidding/bidding-client.ts`
- `src/bidding/bidding-client.test.ts`
- `src/bidding/mail-intake-queue.tsx`
- `src/bidding/mail-intake-queue.test.tsx`
- `src/bidding/buyer-workspace.tsx`
- `src/bidding/buyer-workspace.test.tsx`
- `src/styles.css`

## Forbidden scope

No backend, migration, RLS, RPC implementation, Realtime, dependency, provider connector, credential, OAuth/token/password, mailbox fetch/delivery, polling/webhook/cron, raw message/provider identity, intake-to-bid conversion, automatic bid creation, `CreateBidForm` behavior, Production connection, operational mail data, deployment, or file outside the allowlist.

## Database and migration plan

None. The browser will consume only the already-reviewed `public.list_mail_intake_items` and `public.dismiss_mail_intake_item` RPCs. Repository, local replay, and owner-verified remote migration states remain separate records.

## Test scenarios

- Positive, denial, and cross-organization cases: valid pending/dismissed parsing; compact candidate/warning rendering; exact list/dismiss calls; active-BUYER shared wording; provider/source omission; authorization clear-and-recheck; existing BUYER/TRADER isolation regression suite.
- Client-claim bypass, inactive/suspended, and privilege cases: browser adapter accepts only membership ID plus item ID/revision; exposes no ingest or raw client; malformed results fail closed; server remains the authorization boundary.
- Concurrency cases where relevant: target-bound ID/revision confirmation; refresh/replacement/removal invalidates confirmation; conflict/lifecycle/not-found forces authoritative reload while retaining a fixed error; stale list/dismiss responses after unmount, membership change, or newer operation are ignored.

## Validation commands

Run `npm ci`; `npm audit --json`; `npm audit --audit-level=critical`; `npm audit --omit=dev --audit-level=high`; lint; typecheck; Vitest; build; foundation checker; `git diff --check`; status; and allowlist diff. Database commands are not required by the PR brief because no backend changes are in scope; remote database-validation remains the CI gate.

## Stop conditions

Stop for a dirty tree or base mismatch, migration-history mismatch, unexpected open PR, any backend/RPC/migration/Realtime/dependency/provider/credential/conversion requirement, a required file outside the allowlist, or conflict with a canonical contract.

## Git and PR rules

Create one commit titled `feat: add buyer mail intake queue`, push only the feature branch, and open a Draft PR with the same title against `main`. Do not mark ready, merge, deploy, modify Production Supabase, register secrets, change Vercel settings, clean branches, or start provider connector work.

## Completion report

Record repository/branch, starting and final HEAD, exact files, parser and RPC contracts, absence of ingest, queue/dismiss/stale/auth behavior, bid-workspace isolation, excluded changes, canonical Production-state docs, tests and totals, audits, lint, typecheck, build, foundation checker, diff/status, Draft PR, exact-head CI/database-validation, Vercel Preview, and deviations.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning was requested because authorization failure and stale asynchronous results must fail closed.

## Owner approval point

The Draft PR is the handoff boundary. Human approval is required before readiness, merge, deployment, or any Production change.
