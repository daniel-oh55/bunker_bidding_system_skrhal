# AI Task Card — PR #52

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `b4905f32df1af2b76afeaff96996e4772676ce3a`
- Working branch: `feat/pr-52-unify-manual-bid-publish`
- Target PR and expected HEAD: draft PR #52; implementation commit to be created after validation
- Working tree status: clean immediately before branch creation; no merge, rebase, cherry-pick, revert, or bisect operation active

## Current migration state

- Repository migrations: seventeen, ending `20260902060817_unify_manual_bid_publish.sql`
- Local clean-replay status: passed through all seventeen repository migrations; pgTAP passed 15 files and 802 assertions, including the new 42-assertion manual Publish suite
- Remote applied status: read-only linked history ends `20260901063926_seller_quote_response_model.sql`; PR #51's `20260902030228_mail_intake_prepared_bid_publish.sql` is repository-only and unapplied in Production

## Single purpose

Make ordinary manual new-BID creation use the same explicit Publish contract as Mail Intake Publish: an active authenticated BUYER reviews editable values, supplies a future deadline, selects at least one active SELLER, and explicitly publishes one authoritative BID whose access and awaiting-response rows are limited to the selected SELLER organizations.

## Protected business invariant

No manual or locally prepared `.msg` draft becomes a BID without explicit human Publish by the actual authenticated active BUYER. Every newly published BID has a server-validated future deadline, at least one distinct selected active SELLER organization, server-derived current Asia/Seoul `bid_date`, immutable `created_by`, current responsible-BUYER behavior, selected-only explicit access and matching awaiting responses, and exactly one created audit written in the same transaction. Browser callers cannot retain or invoke an older `create_bid` overload to bypass the deadline or SELLER-selection contract. Existing deadline close, participant mutation, quote response, manual Award, and Mail Intake idempotency/concurrency semantics remain unchanged.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | authenticated user, active account, active BUYER org and membership matching submitted membership ID | active BUYERs and active SELLERs | publish manual BID with future deadline, valid fuel items, and one or more selected active SELLER IDs | unchanged existing BID operations | explicit draft to authoritative BID | allowed through the one current `public.create_bid` signature |
| Active selected TRADER | authenticated active TRADER membership in selected organization | selected BID and own awaiting response | unchanged quote response behavior | own response/quote only | unchanged lifecycle | sees the BID and starts awaiting |
| Active unselected TRADER | authenticated active TRADER membership outside selected scope | no BID visibility | none | none | none | denied by selected-only scope |
| Inactive/suspended/cross-user/anonymous/TRADER publisher | missing an active matching BUYER authority | none beyond existing policy | no manual publish | none | none | denied server-side even with forged membership or organization inputs |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Required future deadline | existing BID deadline storage remains authoritative | direct private table access denied | `create_bid` and shared helper reject null/non-future values | required datetime input |
| Non-empty distinct active SELLER scope | existing access/response keys and FKs | selected rows govern TRADER visibility; private tables remain denied | shared helper rejects null/empty/null member/duplicate/inactive/non-TRADER IDs | all active SELLERs default on, toggles allowed, zero selection warns and disables Publish |
| Authenticated BUYER is actor | n/a | no client-supplied identity authority | existing active-BUYER verifier binds membership to `auth.uid()` | form is in BUYER workspace only |
| One current browser contract | PostgreSQL function identity includes input types | n/a | old eight-argument overload is dropped; only authenticated nine-argument `create_bid` is granted | client always sends selected SELLER IDs |
| Transactional authoritative creation | existing uniqueness/integrity relations | no direct browser writes | helper creates BID, items, selected access, matching awaiting responses, and one audit in one call | one explicit `Publish BID` submit |
| Local `.msg` remains advisory | n/a | n/a | parsing invokes no RPC | parsed values remain editable draft values until Publish |

## Allowed files

- `docs/AI_TASK_CARD_PR_52.md`
- One new forward migration in `supabase/migrations/`
- Relevant pgTAP files in `supabase/tests/database/` and genuinely affected integration/concurrency fixtures in `scripts/`
- `src/bidding/bid-form.tsx`, `src/bidding/bidding-client.ts`, `src/bidding/buyer-workspace.tsx`, and their directly affected tests
- Necessary truth updates only in `PROJECT_STATE.md`, `docs/PRODUCT_AND_SCOPE.md`, `docs/SECURITY_MODEL.md`, and `docs/ARCHITECTURE.md`

## Forbidden scope

- BUYER board redesign, BID ordering, card polish, drag-and-drop, personal ordering, SELLER ranking redesign, automatic winner selection, new fuel grades, raw mail persistence, legacy Firebase changes, Auth/Vault/Cron/secrets, remote Supabase migration or data mutation, Production or Vercel Production deploy, Ready-for-review transition, merge, or unrelated dependency upgrades

## Database and migration plan

- Create one CLI-named forward migration.
- Drop the old eight-argument `public.create_bid` signature with `RESTRICT` so PostgreSQL cannot retain an authenticated overload bypass.
- Tighten `app_private.create_authoritative_bid` so every explicit array is non-empty and, because no legitimate current caller needs legacy null-to-all semantics after this PR, reject null as well.
- Create one nine-argument fixed-search-path `SECURITY DEFINER` `public.create_bid` signature requiring deadline, fuel arrays, and selected SELLER IDs; grant only `authenticated`, revoke `PUBLIC`/`anon`, and preserve private helper denial.
- Reuse the existing authoritative helper so BID/items/access/awaiting/audit creation stays transactional and `bid_date` remains server-derived.

## Test scenarios

- Positive, denial, and cross-organization cases: one and multiple selected active SELLERs; subset-only access; exact access/awaiting equality; one created audit; authenticated creator and responsible BUYER preservation; selected visibility and unselected invisibility.
- Client-claim bypass, inactive/suspended, and privilege cases: null/non-future deadline; null/empty/duplicate/null-member/inactive/non-TRADER SELLER input; invalid fuel data; TRADER, inactive account/membership/org, and cross-user membership denial; private helper denial; old signature absent/unexecutable.
- Concurrency cases where relevant: unchanged Mail Intake repeat/concurrent publish; existing membership, BID lifecycle, quote/award, Realtime/Auth, and quote REST suites remain green.

## Validation commands

`npm ci`; all four audit/reporting commands from the repository agreement; lint; typecheck; unit tests; build; foundation check; diff check; local database start/reset/pgTAP; all CI integration/concurrency suites; database stop; then exact-head GitHub checks including Vercel Preview.

## Stop conditions

Stop for a dirty tree, HEAD mismatch, unexpected migration-history mismatch, conflicting open PR, unsafe dependency on the old function signature, canonical-contract conflict, remote mutation requirement, or a hard-gate audit/test failure that cannot be resolved within this PR.

## Git and PR rules

One scoped draft PR #52 from `feat/pr-52-unify-manual-bid-publish`; no force/reset, Production mutation, deployment, Ready transition, or merge. Preserve merged migrations and use only a forward migration.

## Completion report

Record repository/origin, starting SHA, branch, final HEAD/commits, exact files and migration, final public signature and old-signature denial, deadline/SELLER/scope/UI behavior, test totals, database validation, audit classification, exact-head CI and Vercel status, deviations, and confirmation of no merge/deploy/Production mutation.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning; independent security review after implementation because the work changes Auth-bound RPC authorization, `SECURITY DEFINER` execution, lifecycle validation, audit, and organization visibility.

## Owner approval point

Any Production migration/rollback, remote data change, deploy, Ready transition, or merge requires owner approval and is outside this task.
