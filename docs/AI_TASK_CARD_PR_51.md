# AI Task Card — PR #51

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` at `a8a6e6b3522e1c9a7a51f835cfbbd45223c994f9`
- Working branch: `feat/pr-51-mail-intake-prepared-bid-publish`
- Target PR and expected HEAD: draft PR #51; implementation commit to be created after validation
- Working tree status: clean immediately before branch creation

## Current migration state

- Repository migrations: fifteen, ending `20260901063926_seller_quote_response_model.sql`
- Local clean-replay status: not yet run for this task
- Remote applied status: canonical repository records fifteen aligned Production migrations; no remote project is linked or queried in this task

## Single purpose

Turn a pending, normalized mail-intake candidate into a private BUYER prepared-BID form. Only an explicit authorized Publish creates one authoritative BID, limited to the selected active SELLER organizations.

## Protected business invariant

An intake item is not a BID and must be invisible to TRADERs. A pending item can be converted at most once by an active server-verified BUYER. Publish requires a valid future deadline, valid fuel items, and at least one selected active SELLER; it creates the same authoritative BID guarantees as manual creation, grants explicit scope and awaiting response rows only to selected active SELLER organizations, appends exactly one created BID audit, and removes the converted item from the pending queue. While effective-open, scope may change but the final participant cannot be revoked; all participant changes are forbidden after effective close.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | active authenticated BUYER membership | pending normalized intake; active SELLERs | publish selected pending intake | grant/revoke effective-open SELLER scope | pending to converted | allowed through narrow RPCs |
| Active TRADER | active TRADER membership | explicitly scoped authoritative BID only | quote only while effective-open | own quote/response only | none | prepared intake never visible |
| Inactive/suspended/cross-org/anonymous | none | none | none | none | none | denied server-side |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| One conversion per intake | unique converted BID link | private intake/BID tables | row-locking publish transaction | disables duplicate submit and reloads |
| BUYER-only publish | n/a | direct table denial | existing active-BUYER verifier | BUYER screen only |
| Selected active SELLER scope only | scope uniqueness/FKs | direct table denial | create/publish and scope RPC checks | default checked, editable selection |
| Closed-BID scope lock | n/a | direct table denial | effective-open check | disables unavailable controls |
| Deadline and fuel validity | bid constraints | n/a | validated server inputs | required form controls |

## Allowed files

- `docs/AI_TASK_CARD_PR_51.md`, canonical contract docs, relevant `src/bidding/` files and tests
- One new forward migration under `supabase/migrations/` and matching pgTAP tests under `supabase/tests/database/`

## Forbidden scope

- Gmail auto-publish, raw-mail persistence, deadline extraction, board redesign, drag ordering, new fuel grades, production configuration/deploy/Auth changes, merge, and legacy Firebase changes

## Database and migration plan

- Add a forward migration that adds private conversion state/linkage and a narrow fixed-search-path authenticated BUYER publish RPC.
- Factor authoritative creation mechanics so manual creation and intake publish share BID/item/scope/awaiting-response/audit guarantees.
- Preserve the existing server-time effective-close model; do not add a cron close path.

## Test scenarios

- Positive, denial, and cross-organization cases: prefill, selected-only scope/responses, created audit, converted queue removal, manual create regression, trader scope isolation.
- Client-claim bypass, inactive/suspended, and privilege cases: denied publish/list/scope mutation; dismissed, missing deadline, and invalid fuel inputs rejected.
- Concurrency cases where relevant: repeat and concurrent publish of one intake yield exactly one BID and recognized conversion.

## Validation commands

`npm ci`; audit classification commands; lint; typecheck; unit tests; build; foundation check; diff check; then local Docker database start/reset/test/stop when available.

## Stop conditions

Stop for a dirty tree, base mismatch, migration-history mismatch, unexpected existing data, or canonical-contract conflict.

## Git and PR rules

One scoped draft PR; no merge, deploy, remote Supabase link, production mutation, or real operational data.

## Completion report

Record starting and final HEAD; exact files; migration files; tests; audits; CI; deviations; and confirmation of no deploy or merge.

## Recommended model and reasoning

GPT-5.6 Terra, high reasoning for authorization, RLS, transactional conversion, audit, deadline, and concurrency boundaries.

## Owner approval point

Production migration, rollback, deployment, or merge requires owner approval and is out of scope.
