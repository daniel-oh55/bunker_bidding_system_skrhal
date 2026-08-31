# AI Task Card — PR #48

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `c4e2bdd4f8c694375fbee66784ae1d61c714997f`
- Working branch: `docs/pr-48-reconcile-operational-date-production-state`
- Target PR and expected HEAD: Draft PR #48; one documentation/rename commit
- Working tree status: clean at preflight; no merge, rebase, or cherry-pick in progress; no open overlapping PR

## Current migration state

- Repository migrations: fourteen, ending with `20260831071010_bid_operational_date.sql`.
- Local clean-replay status: unchanged by this documentation and filename-only reconciliation; normal validation is required when local Supabase is safely available.
- Remote applied status: all fourteen migrations are Production-applied; the final Production version is `20260831071010 bid_operational_date`.

## Single purpose

Reconcile the repository migration filename and canonical documentation with the completed PR #47 Production operational-date state without changing SQL or application behavior.

## Protected business invariant

The already-applied immutable, server-derived Seoul `bid_date`, organization-scope authorization, audit retention, and lifecycle behavior remain unchanged. This PR changes only documentation and the repository filename needed to match recorded Production migration history.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Repository maintainer | Exact expected `origin/main`; clean tree | Canonical state and migration metadata | Documentation and exact rename only | No SQL/source/test change | None | Production history reconciled without behavior change |
| Browser roles | Existing server authorization | Existing RPC scope | Existing rules only | Existing rules only | Existing rules only | No permission or behavior change |

## Enforcement layers

No enforcement-layer change is authorized. PostgreSQL constraints, RLS, RPC/server functions, and application UX remain exactly as reviewed in PR #47.

## Allowed files

- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_48.md`
- Exact rename from `supabase/migrations/20260831050000_bid_operational_date.sql` to `supabase/migrations/20260831071010_bid_operational_date.sql`

## Forbidden scope

No SQL content, source, test, Auth/RLS/RPC, Production data, Gmail/Cron/Vault/Edge Function, secret, deployment, branch cleanup, Ready state, or merge changes. `docs/AI_REVIEW_PR_47.md` remains historical evidence and is not edited.

## Database and migration plan

Rename only. The base and renamed file must both hash to Git blob `d5cabcc30536e9374096fdd7d6dfaa7ce9e274ec`; the final diff must be an R100-equivalent rename with zero SQL changes. No local or remote migration is applied by this task.

## Production facts reconciled

- PR #47 operational-date migration was applied after merge. Before apply, Production had 24 BIDs, 45 BID/SELLER scope rows, one quote, 52 BID audit rows, and one quote audit row. Immediately after migration, those counts and all existing business/history fingerprints were unchanged; every BID had non-null `bid_date`, backfill mismatches against `(created_at AT TIME ZONE 'Asia/Seoul')::date` were zero, the old unfiltered public `list_bids` signature was absent, the date-scoped signature and required BID triggers were present, and the reviewed fixed empty-`search_path` boundaries for `current_bid_date`, `list_bids`, `create_quote`, and `update_quote` remained intact. `current_bid_date` remained non-executable by browser roles.
- One controlled synthetic BID, described only as `PR47 PROD SMOKE`, was created through the real authenticated Production BUYER browser path. It had `bid_date` `2026-08-31`, a `created_at` mapping to that Seoul date, revision 1, raw `open` status, zero quotes, one created audit at resulting revision 1, matching audit date and SELLER-scope snapshots, and five explicit current active SELLER scope rows. The five organization scopes demonstrate the PR #44 creation-time snapshot contract; they do not imply five TRADER Auth identities or memberships.
- The synthetic BID was not deleted. It was cancelled through the normal authenticated BUYER lifecycle UI/RPC and remains `cancelled` effectively and raw, at revision 2 with `cancelled_at`, five retained SELLER scope rows, zero quotes, two BID audit events (`created`, `cancelled`), cancelled audit revision/status 2/`cancelled`, the actual cancel actor, and correct retained date/status snapshots. Non-smoke retained state remains 24 BIDs, 45 scope rows, 52 BID audits, one quote, and one quote audit.
- Verified live smoke is limited to BUYER frontend creation, server date, active-SELLER scope snapshot, created audit snapshot, normal cancel, and retained history. No direct authenticated Production TRADER today-only UI or quote-create/update smoke is claimed; those paths remain supported by reviewed SQL, pgTAP, integration tests, exact-head CI, and Claude Code PR #47 review evidence.
- Production advisor wording remains architectural: RLS-enabled/no-policy private-table findings intentionally reflect direct browser denial and narrow verified RPC use; authenticated `SECURITY DEFINER` public-RPC warnings identify intended application entry points with server-side membership checks. The unrelated Leaked Password Protection advisory is out of scope.

## Test scenarios

- Positive: renamed migration hashes exactly to the base blob and Git detects a 100% rename.
- Denial/bypass: no SQL content, duplicate old migration, source, or authorization change may enter the diff.
- Concurrency: not applicable; this PR does not change executable behavior.

## Validation commands

Run required dependency audits, lint, typecheck, tests, build, foundation check, whitespace check, and local database replay/pgTAP only when local Supabase can be used without affecting another project. Confirm exact-head GitHub `validate` and `database-validation` and Vercel Preview after opening the Draft PR.

## Stop conditions

Stop for a dirty tree, base SHA mismatch, concurrent PR, rename-content mismatch, unexpected required file, or any need to change SQL/source/tests/Production.

## Git and PR rules

Use only `docs/pr-48-reconcile-operational-date-production-state`, prefer commit `docs: reconcile operational date production state`, push it, and open Draft PR #48 against `main`. Do not mark Ready or merge.

## Completion report

Record preflight, SHAs, six allowed logical changes, old/new migration names and blob proof, migration count, documented Production state, validations, CI, Vercel Preview, Draft PR state, and confirmation of no Production/secret/deploy change.

## Recommended model and reasoning

GPT-5.6 Terra / Medium. No new security review is required unless the final diff leaves the authorized documentation/rename scope.

## Owner approval point

The owner approval for PR #47's Production apply is complete. This PR has no Production apply, deploy, Ready, or merge approval.
