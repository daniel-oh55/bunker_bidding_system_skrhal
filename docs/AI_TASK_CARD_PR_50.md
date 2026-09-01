# AI Task Card — PR #50

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` / `1d0211755e34e0b7ffeb2ae1d18da6cdd8e7ac79`
- Working branch: `feat/pr-50-final-ui-release-reconciliation`
- Target PR: Draft PR #50 only; no Ready transition, merge, deployment, or Production action
- Working tree status: clean at branch creation

## Current migration state

- Repository migrations: fifteen, with the final seller-response SQL initially named `20260901090000_seller_quote_response_model.sql`.
- Local clean-replay status: to be established by the required local database validation.
- Remote applied status: fifteen Production migrations; the final ledger version is `20260901063926 seller_quote_response_model`. This task must not connect to or mutate Production.

## Single purpose

Finalize small BUYER/TRADER presentation improvements and reconcile the repository migration filename and canonical documentation with the supplied Production state.

## Protected business invariant

Explicit BID scope, verified active membership, and active organization status remain the server-enforced authorization authority. Retained response state (`awaiting`, `quoted`, `gave_up`) is commercial history only and never grants access. The UI may accurately present current quoted offers, but cannot alter server authorization, quote lifecycle, ranking, awards, or audit behavior.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | Existing server-authorized workspace access | Existing BID board/detail | Existing BID UI only | Select detail / existing UI actions | None added | Explicit Manage moves focus only after successful detail load |
| Active scoped TRADER | Existing server-authorized workspace access | Existing own bids/quotes | None | None | None | Summary counts only active quoted responses |
| Background reload | Existing selected detail | Existing authoritative reload | None | None | None | Must never programmatically scroll or steal focus |
| Unauthorized/inactive actor | Missing server condition | Existing denial | None | None | None | No new capability; existing server boundary remains final |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| BID scope is authority | Existing | Existing | Existing | Display only; no authority claim |
| Current comparison quote | Existing retained response/quote data | Existing | Existing comparison result | Count only quoted, scoped, active-organization quote rows |
| Manage-detail attention | N/A | N/A | Existing authoritative detail reads | Explicit user click only; focus with `preventScroll` after one scroll |

## Allowed files

- Focused BUYER/TRADER workspace and board-card components plus their direct tests
- `src/styles.css` only if needed for accessible detail focus
- The four named canonical documents and this task card
- Pure seller-response migration filename rename and narrow repository references/tests needed to retain replay coverage

## Forbidden scope

No SQL-content change; no RPC, RLS, Auth, membership, audit, award, response-state, Realtime, mail-intake, provisioning, secret, deployment, Production, or legacy Firebase change.

## Database and migration plan

Record the existing migration blob hash; rename only the file to the Production ledger version; verify the same hash afterward. Keep all migration SQL and upgrade-regression behavior unchanged.

## Test scenarios

- Positive: Create new bid is before secondary SELLER/mail tools for today; explicit Manage scrolls and focuses once after authoritative detail success; active quoted rows count as current quotes.
- Denial/bypass: historical date still has no create action; Refresh/Realtime/mutation retained-detail reloads do not focus; gave-up retained quote remains visible history but yields zero current quotes.
- Cross-organization, privilege, and concurrency: no code-path or database-boundary changes; retain existing regression coverage.

## Validation commands

Run the repository-required npm audits/checks, rename check, local Supabase replay/pgTAP when Docker is available, and `npm run db:test:response-upgrade`.

## Stop conditions

Stop for a dirty tree, base mismatch, a non-byte-identical migration rename, any required authorization/database change, migration replay mismatch, or unavailable local Docker after one clear attempt.

## Git and PR rules

Use a focused commit, push only `feat/pr-50-final-ui-release-reconciliation`, and open a Draft PR against the exact base only after validation. Do not mark Ready, merge, deploy, or touch Production.

## Completion report

Record starting/final HEAD, exact changed files, both migration paths and hashes, focused tests/audits/database validation, CI/Preview/PR state, deviations, and confirmations that Production and security behavior were untouched.

## Recommended model and reasoning

High reasoning for reconciliation checks; independent security review is not required while the SQL content and server-side behavior remain unchanged.

## Owner approval point

Owner approval is required for Production activity, deployment, Ready transition, or merge; none is authorized here.
