# AI Task Card — PR #31 Server-side Mail Intake Foundation

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@ec6f72730086cb6194aeb69c977591e3fd40c149`
- Working branch: `feat/pr-31-mail-intake-foundation`
- Target PR and expected HEAD: Draft PR #31 against `main`; final HEAD to be recorded at handoff
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress

## Current migration state

- Repository migrations: seven migrations through `20260808090000_realtime_workspace_notifications.sql` before this PR; this PR adds one forward migration
- Local clean-replay status: pending `npm run db:start`, `npm run db:reset`, and `npm run db:test`
- Remote applied status: not queried or inferred; no remote Supabase project is linked or changed by this PR

## Single purpose

Add the private PostgreSQL queue and least-privilege RPC boundary needed for a future trusted server mailbox connector, without connecting a mailbox or creating bids.

## Protected business invariant

Only the trusted Supabase service-role ingress RPC may persist normalized provider-originated intake, and a source identity can create at most one immutable intake item even under concurrency. Only an authenticated user whose selected membership is verified by PostgreSQL as an active BUYER may list pending items or dismiss one at the expected revision. Browser callers never receive source mailbox/message identifiers, never receive provider or service credentials, and intake never creates or authorizes a bid.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Trusted server connector (Supabase service role) | Normalized, bounded provider payload | Returned internal UUID only | Ingest one pending identity | None; duplicate input is non-overwriting | None | New identity inserts once; duplicate returns the existing UUID |
| Active approved BUYER | `auth.uid()` matches an active BUYER membership in an active BUYER organization | Shared pending queue through RPC only | Denied | Denied | Dismiss pending item at exact revision | Actual user/membership recorded and revision increments once |
| Another active approved BUYER | Independently verified active BUYER membership | Same shared pending queue | Denied | Denied | May dismiss pending item at exact revision | Queue is global to active BUYERs, not organization-partitioned |
| TRADER | Any active TRADER membership | Denied | Denied | Denied | Denied | `42501`; no queue visibility |
| Inactive/suspended/forged caller | Account, membership, or organization inactive, or selected membership not owned by `auth.uid()` | Denied | Denied | Denied | Denied | `42501`; client claims cannot bypass database state |
| `anon` / `authenticated` direct table caller | Any claims | Denied | Denied | Denied | Denied | RLS plus revoked direct table privileges fail closed |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Normalized minimal storage | Exact scalar/JSON checks, status consistency, revision floor, foreign keys | Enabled on private queue | Ingest validates and normalizes bounded fields with `22023` failures | No UI change in this PR |
| Idempotent source identity | Unique `(source_provider, source_mailbox_key, source_message_id)` | No direct policies | `INSERT ... ON CONFLICT DO NOTHING`, then return stored UUID without updates | No UI change |
| Ingress authority | No direct `anon`/`authenticated` table privileges | No direct policies | Fixed-search-path `SECURITY DEFINER`; EXECUTE only for the Supabase service role | Browser receives no secret credential |
| BUYER queue authority | Private table and narrow result type | No direct policies | Existing `require_active_buyer_actor()` verifies `auth.uid()` and active database rows | Future UX may mirror pending-only visibility |
| Dismiss transition | Status/dismissal-field consistency and revision floor | No direct policies | Row lock, expected-revision check, one-way transition, server actor/time, one increment | No restore action exists |
| Bid separation | No bid/deadline/responsibility columns or foreign key | Existing bid RLS unchanged | No call to `create_bid` and no conversion function | Existing create flow unchanged |

## Allowed files

- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_31.md`
- `supabase/migrations/20260821070000_mail_intake_foundation.sql`
- `supabase/tests/database/05_mail_intake_foundation.sql`
- `scripts/check-foundation-boundaries.mjs`
- `scripts/check-foundation-boundaries.test.mjs`

## Forbidden scope

- No `src/**`, package, CI, legacy, Vercel, Supabase configuration, existing migration, or existing database-test changes
- No provider SDK, mailbox connection, OAuth, password/token, polling, webhook, cron, Edge/Vercel function, dependency, secret, environment variable, Realtime trigger, real message, or operational data
- No raw body, HTML, attachment, address, deadline, responsible-BUYER, TRADER, seller, quote, award, generic raw payload, conversion marker, or bid relation in intake storage
- No bid creation, deadline inference, responsibility inference, restore/undismiss, Production migration, deploy, or merge

## Database and migration plan

Create one forward migration containing the private status and API-result types, the private normalized queue with RLS and revoked direct privileges, immutable JSON-shape validators used by table constraints and ingress, a server-time update trigger, a narrow result helper, service-role-only idempotent ingest, authenticated active-BUYER pending-list, and revision-locked one-way dismiss.

## Test scenarios

- Positive, denial, and cross-organization cases: valid service ingestion; normalized storage; active BUYER A/B shared pending visibility; TRADER, inactive account, inactive membership, inactive organization, and forged membership denial; successful dismissal removed for both BUYERs.
- Client-claim bypass, inactive/suspended, and privilege cases: exact RLS/CRUD/EXECUTE checks; `SECURITY DEFINER` plus empty search paths; authenticated and anonymous ingest denial; service-role ingest grant; source identifiers absent from BUYER result; forged metadata provides no authority.
- Input and minimization cases: provider/mailbox/message/text limits; opaque mailbox key; exact bounded fuel and warning JSON; forbidden columns absent; malformed input fails `22023` without repair.
- Concurrency cases where relevant: the unique source-identity constraint is authoritative; duplicate RPC calls never update state. Run a deterministic two-session local duplicate-ingest race without adding a disallowed standalone script.

## Validation commands

Run `npm ci`, all required audit variants, lint, typecheck, full Vitest, build, foundation check, local Supabase start/reset/pgTAP/stop, relevant existing concurrency regressions, a two-session duplicate-ingest race, and Git diff/status checks.

## Stop conditions

Stop for a dirty tree or base mismatch; migration-history mismatch; conflicting open PR; inability to prove service-role-only ingress or direct-table denial; non-concurrency-safe deduplication; need for a browser secret, provider connector, unrelated contract change, or any file outside the allowlist; production audit hard gate; unexpected operational data; or conflict with a canonical contract.

## Git and PR rules

Create one commit titled `feat: add mail intake server foundation`, push only the feature branch, and open a Draft PR with the same title against `main`. Do not mark ready, merge, deploy, link or mutate Supabase Production, configure secrets, connect a mailbox, or delete branches.

## Completion report

Record preflight and safe main fast-forward; starting/final HEAD; exact files and migration; private objects and exact grants; ingress/direct-table denial; dedupe and concurrency outcome; minimization; BUYER/TRADER/inactive authorization; dismiss actor/revision result; pgTAP totals; frontend/audit/build/foundation/diff checks; Draft PR and exact-head CI/Vercel state; deviations; and confirmation of no Production mutation, mailbox connection, secrets, deploy, or merge.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning, as requested for this service-role, authorization, idempotency, and revision-locking boundary.

## Owner approval point

The Draft PR is the handoff boundary. Owner review and independent security review are required before readiness or merge; explicit owner approval is required before any Production migration, mailbox work, secret configuration, or deployment.
