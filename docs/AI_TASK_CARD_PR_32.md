# AI Task Card — PR #32 Mail Intake Service-role + Concurrency Hardening

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@eb3d369c5f37b5cf7dd4804ff97dce11d7546634`
- Working branch: `fix/pr-32-mail-intake-hardening`
- Target PR and expected HEAD: Draft PR #32 against `main`; final HEAD to be recorded at handoff
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress; no conflicting open PR

## Current migration state

- Repository migrations: PR #31's mail-intake foundation is merged; this PR adds one forward hardening migration without rewriting it
- Local clean-replay status: pending `npm run db:start`, `npm run db:reset`, and database tests
- Remote applied status: not queried or inferred; the mail-intake migrations remain unapplied to Production by this PR

## Single purpose

Narrow the elevated server connector's mail-intake application surface to ingest-only and add a committed deterministic two-session duplicate-ingest regression for normal READ COMMITTED isolation.

## Protected business invariant

The unique `(source_provider, source_mailbox_key, source_message_id)` constraint remains the authoritative identity boundary. The elevated connector role may persist normalized candidates only through the fixed-search-path `SECURITY DEFINER` ingest RPC; it cannot list or dismiss intake items and has no direct private-table CRUD. Duplicate concurrent ingest returns one stable UUID and never overwrites the winning row, whether the first transaction commits or rolls back. Existing active-BUYER list/dismiss authority and all TRADER denials remain unchanged.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Elevated server connector | Valid normalized provider payload | Denied list and direct SELECT | Ingest RPC only | Direct UPDATE denied; duplicate never overwrites | Dismiss denied | One identity produces one pending revision-1 row |
| Active approved BUYER | Server verifies `auth.uid()` and active BUYER membership/organization | Pending queue through list RPC | Ingest denied | Direct table CRUD denied | Dismiss through revision-checked RPC | Existing BUYER contract remains intact |
| Active TRADER | Any active TRADER membership | Mail intake denied | Ingest denied | Direct table CRUD denied | Dismiss denied | Existing TRADER contract remains intact |
| `anon` | None | List and direct table access denied | Ingest and direct INSERT denied | Direct UPDATE denied | Dismiss and direct DELETE denied | All mail-intake access fails closed |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Source identity | Existing authoritative unique tuple | Existing private-table RLS remains enabled | Existing non-overwriting ingest body is unchanged | No application change |
| Connector authority | Existing table constraints remain unchanged | Direct table access remains unavailable | Forward migration pins ingest EXECUTE and revokes list/dismiss EXECUTE plus table CRUD | No credential or connector work |
| BUYER/TRADER authority | Existing data model remains unchanged | Existing private boundary remains unchanged | Authenticated list/dismiss grants and server-verified BUYER checks remain unchanged | No UI change |
| Duplicate concurrency | Unique index arbitrates both wait/recheck paths | Not applicable | READ COMMITTED RPC calls return the committed winner or insert after rollback | Future connector must tolerate lock waits and retry `40001` when received |

## Allowed files

- `PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/AI_TASK_CARD_PR_32.md`
- `supabase/migrations/20260821100000_mail_intake_ingress_hardening.sql`
- `supabase/tests/database/06_mail_intake_ingress_hardening.sql`
- `scripts/test-mail-intake-concurrency.mjs`
- `package.json`
- `.github/workflows/ci.yml`

## Forbidden scope

- No existing migration/test, `src/**`, lockfile, foundation-checker, legacy, Vercel, or Supabase configuration changes
- No provider connectivity, OAuth, credential, polling, webhook, cron, mailbox data, bid creation, Production mutation, deploy, merge, or branch cleanup
- No function-body, source-identity, bid API, BUYER authorization, data-model, global-role, or stronger-isolation change

## Database and migration plan

Add a forward migration that explicitly revokes SELECT/INSERT/UPDATE/DELETE/TRUNCATE on `app_private.mail_intake_items` and list/dismiss EXECUTE from the elevated connector role, while explicitly retaining its ingest EXECUTE. Re-pin authenticated list/dismiss and all existing anonymous/authenticated denials. Add a transactional pgTAP test for catalog privileges and actual role behavior.

## Test scenarios

- Positive, denial, and cross-organization cases: elevated role can ingest; active BUYER can list/dismiss; TRADER cannot list/dismiss; authenticated and anonymous callers retain the existing RPC restrictions.
- Client-claim bypass, inactive/suspended, and privilege cases: direct CRUD is absent for the elevated role; actual direct table access fails; no client metadata or membership claim is introduced as authority.
- Concurrency cases where relevant: session B is observed blocked by session A through `pg_blocking_pids()` for the same source identity. If A commits, B returns A's UUID and cannot overwrite A's row. If A rolls back, B inserts its candidate as the sole pending revision-1 row.

## Validation commands

Run the required npm install, audit, lint, typecheck, Vitest, build, and foundation checks; local Supabase start/reset/pgTAP/stop; the new mail race plus existing membership, bid, and quote races when the local stack is available; then diff, allowlist, and status checks.

## Stop conditions

Stop for a dirty tree, HEAD mismatch, migration-history mismatch, unexpected existing data, conflict with a canonical contract, inherited/default privilege paths that defeat explicit revocation, need for any file outside the allowlist, unavailable required authority, or a production audit hard gate. An unrelated port 54322 conflict blocks only local database validation and must not be mutated.

## Git and PR rules

Create one commit titled `fix: harden mail intake service-role boundary`, push only the feature branch, and open a Draft PR with the same title against `main`. Do not mark ready, merge, deploy, apply Production migrations, connect a provider, configure secrets, or clean branches.

## Completion report

Record the repository/branch, starting and final HEAD, exact files, privilege state, pgTAP totals, both concurrency outcomes, foundation and application checks, local Supabase status, Draft PR, exact-head CI jobs, Vercel status, and confirmation of no forbidden external action.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning was requested for this privilege and concurrency boundary.

## Owner approval point

The Draft PR is the handoff boundary. Owner and independent security review are required before readiness or merge; explicit owner approval is required before any Production migration, connector, secret, or deployment work.
