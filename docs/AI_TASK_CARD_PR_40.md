# AI Task Card — PR #40 Operational SPOT Parser

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `ab8cffa9fdcb59ced3c0153e191b4c4fc6c778cd`
- Working branch: `fix/pr-40-operational-spot-parser`
- Target PR and expected HEAD: Draft PR #40 against `main`; one implementation commit preferred
- Working tree status: clean at preflight; no merge, rebase, or cherry-pick in progress; no overlapping open PR

## Current migration state

- Repository migrations: eleven existing migrations; this task adds or changes none
- Local clean-replay status: not run because another local Supabase project was active on the standard ports; this parser-only task does not change database artifacts, and GitHub database validation remains the authoritative gate
- Remote applied status: repository documentation records all eleven migrations as applied; no remote project is linked or inspected for this task

## Single purpose

Improve the existing shared bunker-request parser so the synthetic equivalent of the observed operational exact-marker `//SPOT//` mail shape produces useful normalized review candidates without false supported-fuel specification warnings.

## Protected business invariant

Parser output remains advisory and non-authoritative. It may suggest only vessel/voyage, port, delivery text, and supported fuel quantities for human review. It never infers or creates a deadline, responsible BUYER, seller, TRADER, quote, award, sender/recipient, organization, authority, or bid. Exact-marker eligibility, bounded plain-text handling, raw-data non-retention, and explicit server-authorized bid creation remain unchanged.

Source precedence is:

- Vessel: explicit non-empty body `VSL`/`VESSEL` field, existing clear `BUNKER REQUEST` subject extraction, then the narrow structured trailing subject fallback.
- Port: explicit body port/terminal field, existing clear `BUNKER REQUEST ... AT ...` subject extraction, then the narrow structured trailing subject fallback.
- Delivery: explicit `DELIVERY WINDOW`, `DELIVERY DATE`, or `SUPPLY DATE`, then the narrow structured trailing subject date, then advisory `ETA <value>` with its existing verification warning.

The structured fallback accepts only a final parenthesized three-part slash summary with non-empty vessel, date, and port segments where the date contains a recognized English month token and four-digit year. It is not a free-form parenthetical parser.

Supported-grade lines without an MT/M/T marker are specification text, not quantity attempts, and create no invalid-quantity warning. A supported-grade line with an MT/M/T marker and an invalid preceding quantity remains rejected and warned. Unsupported and generic fuel behavior is unchanged.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Shared parser caller | Plain-text subject/body supplied within the existing adapter boundary | Input strings in memory | Review-only normalized draft | None | None | Conservative candidates and warnings only |
| Gmail connector | Exact case-sensitive first-character `//SPOT//` gate already passed | Existing bounded inline plain text | Existing normalized queue ingress only | None | Existing cursor flow only | Stored subject retains marker; parser sees only marker-stripped subject |
| BUYER reviewer | Existing server-verified BUYER access | Existing pending candidate view | Bid only through unchanged explicit Create bid action/RPC | Human may edit applied candidates | Existing authorized lifecycle only | Parser output grants no authority |
| TRADER, anonymous, or unauthorized caller | Any | No new access | No parser-created bid or authority | None | None | Existing authorization boundaries remain unchanged |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Parser output is advisory | No database change | Existing policies unchanged | Existing ingest/create RPC contracts unchanged | Candidates and warnings only |
| No deadline or responsible BUYER inference | No schema field added | Unchanged | No new parameter or call | Parser draft omits authority fields |
| Exact `//SPOT//` gate and raw-data boundary | Unchanged | Unchanged | Existing connector boundary unchanged | Focused connector regression only |
| Source precedence and narrow subject parsing | Pure parser logic | Not applicable | Not applicable | Deterministic unit tests |
| Fuel specification rows do not create false warnings | Pure parser logic | Not applicable | Not applicable | Valid/invalid/unsupported regression tests |

## Allowed files

1. `src/bidding/bid-intake.ts`
2. `src/bidding/bid-intake.test.ts`
3. `supabase/functions/tests/gmail-mail-intake.test.ts`
4. `docs/AI_TASK_CARD_PR_40.md`
5. `PROJECT_STATE.md`
6. `docs/PRODUCT_AND_SCOPE.md`

## Forbidden scope

Do not change Gmail connector source or adapter, Edge entrypoint/config, exact marker eligibility, cursor/reset/rescan semantics, mail intake RPCs, migrations, RLS/Auth/membership, queue schema/idempotency/data, frontend/UI or Apply behavior, bid creation, deadlines, Realtime, Cron, Vault, secrets, Vercel, Production configuration, deployment, or legacy Firebase. Use synthetic-only test identities and data; do not reprocess historical or pending queue items.

## Database and migration plan

No database, SQL, migration, RLS, RPC, data, or remote-state change. PostgreSQL remains authoritative for persistence and authorization; this pure parser remains an advisory presentation/input helper.

## Test scenarios

- Positive, denial, and cross-organization cases: parser positives cover simple bullets, all vessel labels, precedence, legacy English subject behavior, single-date/range structured subjects, delivery and ETA precedence, supported fuel quantities, and an end-to-end synthetic connector payload. Authority, organization, and cross-organization behavior are unchanged and outside this parser-only PR.
- Client-claim bypass, inactive/suspended, and privilege cases: no client role, organization, membership, or metadata is accepted or introduced; existing connector exact-marker and authorization tests remain the denial boundary.
- Negative/bypass cases: month/year-less slash parentheses do not parse; supported specification rows without MT/M/T do not warn; malformed supported MT/M/T quantities still warn; unsupported/generic MGO behavior remains unchanged; every relevant draft assertion verifies no `deadlineAt`.
- Concurrency cases where relevant: not applicable because parsing is pure and stateless; existing queue idempotency and cursor concurrency contracts are unchanged.

## Validation commands

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run src/bidding/bid-intake.test.ts
npm run test:edge
npm run test -- --run
npm run build
npm run check:foundation
git diff --check
```

Run the local database start/reset/test/stop sequence only when Docker and ports are safely available without interfering with another Supabase project. GitHub database validation remains the clean-replay gate because this PR changes no database artifact.

## Stop conditions

Stop for a dirty tree, base SHA mismatch, overlapping PR, migration/RPC need, connector cursor/idempotency or exact-marker change, a required file outside the allowlist, a broad/free-form subject parser requirement, real operational fixture data, or an audit hard-gate failure. Preserve the working tree and report before expanding scope.

## Git and PR rules

Prefer one commit named `fix: support operational SPOT mail parsing`. Push only `fix/pr-40-operational-spot-parser` and open a Draft PR against `main`. Do not mark Ready, merge, deploy, invoke the connector, reset cursors, alter queue rows, or change Production services/configuration.

## Completion report

Record preflight; starting main SHA, branch, starting/final HEAD, commit; exact changed files; implemented precedence and narrowness; fuel warning behavior; focused/Edge/full test counts; audits and build checks; GitHub CI and Draft PR state; deviations; and explicit confirmation that no Production, Gmail, cursor, queue, Cron, Vault, secret, or Vercel change occurred.

## Recommended model and reasoning

Medium reasoning is appropriate because this is a pure parser/test/documentation change with no authorization, migration, lifecycle transition, deadline creation, or concurrency implementation.

## Owner approval point

After merge, any Production Gmail Edge Function deployment and controlled smoke require explicit owner approval. This PR does not deploy or claim that Production or existing pending rows were reparsed.
