# AI Task Card — PR #44

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `4fc5616768bbfc0e3ef07f98039659e3e29f684e`
- Working branch: `feat/pr-44-default-seller-bid-participation`
- Target PR and expected HEAD: Draft PR #44; one focused implementation commit on the base above
- Working tree status: clean at preflight; no merge, rebase, or cherry-pick in progress; no open overlapping PR

## Current migration state

- Repository migrations: twelve baseline migrations through `20260828005713_trader_organization_admin.sql`; this PR adds only `20260828050000_default_seller_bid_participation.sql`
- Local clean-replay status: pending implementation validation
- Remote applied status: not inferred from an unconnected project; this repository feature must not be described as Production-applied

## Single purpose

Snapshot every currently active SELLER (the existing `kind = trader` organization identity) into explicit per-BID access during successful new-BID creation, and show scoped SELLERs without quotes as `Awaiting quote` on the BUYER operational board through one narrow BUYER-only comparison RPC.

## Protected business invariant

New BID creation and default scope insertion are one transaction. The active-SELLER selection inserts one explicit access row per organization that is `kind = trader` and `status = active`, records the verified creating BUYER user and membership as grant actor, does not revise the BID beyond revision 1, and occurs before the single `created` audit snapshot. No existing BID is backfilled and a later-created SELLER does not gain older-BID authority.

Runtime TRADER authority remains the conjunction of an active account, active membership, active TRADER organization, and current explicit per-BID access row. Historical access rows or retained quotes never substitute for current organization status or current scope. BUYER comparison visibility is broader than TRADER authority only to preserve retained quote history after revoke/inactivation.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| BUYER admin | Verified active BUYER membership | All scoped/unquoted and retained quoted SELLER comparison rows | BID plus default active-SELLER scope | Existing behavior | Existing behavior | Allowed; grant actor is verified caller |
| BUYER operator | Verified active BUYER membership | Same comparison | Same normal BID create behavior | Existing behavior | Existing behavior | Allowed; no admin-only dependency |
| TRADER | Active account, membership, organization, and explicit BID scope | Own scoped BID/quote only | Existing own quote behavior | Existing own quote behavior | Denied BUYER transitions | Comparison RPC denied; no competitor data |
| Inactive/suspended organization | Any retained scope or quote | No TRADER runtime access; BUYER may see retained participant/history | Denied | Denied | Denied | Fails closed despite historical scope |
| Anonymous/forged caller | No verified active BUYER membership | Denied | Denied | Denied | Denied | No RPC or private-table access |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| One scope per BID/SELLER | Existing composite primary key | Private table, no direct grants | `create_bid` inserts active TRADER snapshot | Displays returned participants only |
| Current TRADER authority | Existing organization/membership enums and relations | Private relations | Existing active-TRADER verifier plus explicit scope check | Cannot weaken server denial |
| Default-scope audit | Existing append-only audit constraints | Private audit table | Access rows inserted before one `created` audit | Audit presentation unchanged |
| BUYER comparison | Quote/access identity joins | No direct private-table access | New fixed-search-path `SECURITY DEFINER` BUYER-only RPC | Strict exact-shape parser; nullable quote |
| Comparison eligibility | Existing authoritative `quote_result` flags and total | N/A | Nested quote comes from `app_private.quote_result` | Only non-null eligible quotes rank or drive lowest/gap |

## Allowed files

Only the fifteen files enumerated in the PR #44 request: one new migration, one new pgTAP test, five bidding source files, four bidding test files, `src/styles.css`, the Task Card, and the three narrow contract documents.

## Forbidden scope

No legacy edits, old-migration rewrites, Production apply/deploy, historical backfill, dynamic master-list authorization, Auth/invite/membership work, placeholder quotes or IDs, award/deadline changes, mail/Cron/Vault/secrets, or unrelated redesign.

## Database and migration plan

1. Replace `public.create_bid` with its exact current signature, validation, inserts, return type, and behavior, adding only one set-based insert of active TRADER organizations before the existing created audit.
2. Add `public.list_bid_seller_comparison_for_buyers(uuid, uuid)` as a fixed-empty-search-path `SECURITY DEFINER` function. Verify the active BUYER actor, return the union of current access and retained quote organizations, use `to_jsonb(app_private.quote_result(...))` for non-null quotes, and sort by normalized label then organization ID.
3. Revoke from `public` and `anon`, grant execute only to `authenticated`, and retain all direct private-table denials.
4. Add synthetic pgTAP coverage for default scope, actor/audit/revision invariants, runtime denial, snapshot/no-backfill behavior, manual scope preservation, comparison semantics, privileges, and existing quote/award behavior.

## Test scenarios

- Positive, denial, and cross-organization cases: active admin/operator creation; all active SELLERs scoped; zero active SELLERs; inactive/suspended exclusion; immediate scoped-TRADER read; later SELLER absence; manual grant/revoke; BUYER comparison union and deterministic narrow data; TRADER/anon denial.
- Client-claim bypass, inactive/suspended, and privilege cases: forged membership, inactive organization despite retained scope, private-table direct access denial, exact RPC privileges, malformed/extra frontend protocol fields, and nested identity/metadata mismatch rejection.
- Concurrency cases where relevant: no global lock is introduced; normal PostgreSQL statement/transaction visibility defines the active-SELLER snapshot, while organization active status remains an independent runtime gate. Existing bounded board concurrency and stale-generation protection are regression-tested.

## Validation commands

Run every repository-required command: `npm ci`; all three audit commands; lint; typecheck; full Vitest; build; foundation check; `git diff --check`; and, when the local Docker/Supabase stack is safe and available, db start/reset/test/stop. GitHub database clean replay remains mandatory.

## Stop conditions

Stop for a dirty or moved base, overlapping PR, need to edit an old migration, historical backfill, direct browser table access, dynamic master authorization, quote placeholders, any additional file, dependency hard-gate failure, unsafe conflict with another Supabase stack, or migration-history mismatch.

## Git and PR rules

Prefer one commit `feat: add default seller bid participation`; push only the named branch; open Draft PR #44 against `main`; never mark ready, merge, deploy, apply Production migrations, mutate operational data, or clean remote branches.

## Completion report

Record preflight, starting/final SHA, branch/commit, exact files, migration and RPC contracts, audit and no-backfill proof, retained quote/inactive behavior, frontend semantics, focused/full tests, pgTAP, audits and all checks, GitHub CI, Vercel Preview, Draft PR URL/state, Production non-mutation, and deviations.

## Recommended model and reasoning

High reasoning because the change touches `SECURITY DEFINER`, organization authorization, audit ordering, lifecycle-compatible quote visibility, and stale/concurrent frontend work. Security-sensitive SQL requires an independent Claude Code review per repository policy; Codex will implement and perform focused self-review, while the PR remains Draft pending that external review.

## Owner approval point

Owner approval is required after merge before any Production migration application or deployment. Historical BID backfill is explicitly excluded.
