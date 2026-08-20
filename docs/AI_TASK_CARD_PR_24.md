# AI Task Card — PR #24 Frontend Realtime Production Rollout Reconciliation

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `main` / `eb76258035cdd9e19bb511ae3d758aad0890ad31`
- Working branch: `docs/pr-24-reconcile-frontend-realtime-production`
- Target PR and expected HEAD: Draft PR #24; documentation-only reconciliation commit recorded at handoff
- Working tree status: clean before branch creation; local `main` was fast-forwarded safely from `9cd21e9cfbb1d7f5b3b4ab9f7cd9a0466cf41673` to the exact base

## Current migration state

- Repository migrations: seven reviewed migrations; latest is `20260808090000_realtime_workspace_notifications.sql`.
- Local clean-replay status: not changed by this documentation-only task.
- Remote applied status: seven reviewed migrations are recorded as applied to Production.

## Single purpose

Reconcile the canonical documentation after the completed Production rollout and controlled end-to-end smoke of the existing frontend private Realtime invalidation consumer. No runtime behavior is changed.

## Verified rollout facts

- Merged `main` deployed successfully to Vercel Production at `https://skrhal-bunker-bidding.vercel.app`; no alternate domain is represented as the Production URL.
- Supabase Production was healthy before the controlled smoke, and the BUYER entered its authorized workspace.
- A synthetic bid caused BUYER `workspace_changed`; without refresh or browser reload, the BUYER changed from one to two current bids and displayed the new record.
- A non-scoped TRADER did not see the bid. The selected TRADER began with zero accessible bids, then automatically changed to one after the BUYER granted organization scope; the other TRADER organization remained unable to see it.
- A controlled TRADER membership active-to-inactive transition caused `access_changed`; the protected workspace was removed without refresh and failed closed with no active authorized membership. Membership, account, and organization state were restored and reverified active, and normal sign-in then succeeded.
- Manual Refresh remained available, and a BUYER scope revoke removed TRADER access through the existing post-mutation authoritative reload.
- The temporary Realtime smoke bid was cancelled at revision 4 with zero retained TRADER scope. No real company bidding information was used.

## Protected business invariant

Realtime remains a best-effort invalidation signal only. Existing server RPCs, RLS, and current membership state remain the sole authority for access and bidding data; Realtime cannot grant or broaden authorization.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| BUYER | Active server-verified membership | Authoritative bid RPC result after marker | None | None | `workspace_changed` reload | New synthetic bid appears without manual refresh |
| Scoped TRADER | Active server-verified membership and current scope | Authoritative TRADER RPC result after marker | None | None | `workspace_changed` reload | Newly scoped bid appears without manual refresh |
| Non-scoped TRADER | Active membership without current scope | No bid data | None | None | Marker/reload cannot broaden scope | Bid remains absent |
| Temporarily inactive controlled member | Membership becomes inactive | No protected workspace | None | None | `access_changed` revalidation | Workspace is removed and access fails closed |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Continued access | None | Existing policies | `current_access_context()` | `access_changed` rechecks and clears protected state on denial |
| Bid visibility | Existing data constraints | Existing bid/quote policies | Existing BUYER/TRADER RPCs | `workspace_changed` triggers authoritative reload only |
| Broadcast delivery | Existing private-channel configuration | Existing `realtime.messages` policy | Existing notification functions | Exact marker-only consumer; no send, Presence, or payload rendering |

## Allowed files

- `docs/AI_TASK_CARD_PR_24.md`
- `PROJECT_STATE.md`
- `README.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/RELEASE_AND_OPERATIONS_RUNBOOK.md`

## Forbidden scope

No source, test, migration, RLS, function, trigger, Auth, Realtime setting, Vercel setting, environment, secret, dependency, CI, legacy Firebase, provisioning, invitation, or BUYER/TRADER UX/UI change. Do not touch Production, deploy, alter controlled identities, mark the PR ready, merge, or delete branches.

## Database and migration plan

None. Database enforcement and remote state are unchanged.

## Test scenarios

- Positive: Production deployment succeeded; a BUYER `workspace_changed` automatically reloaded a newly created synthetic bid, and a selected TRADER automatically reloaded it after an authorized scope grant.
- Denial and cross-organization: a non-scoped TRADER and the other TRADER organization did not see the bid; a controlled active-to-inactive membership transition emitted `access_changed` and removed the protected workspace without manual refresh.
- Fallback and recovery: manual Refresh and existing post-mutation authoritative reload worked; the controlled membership/account/organization state was restored and normal sign-in reverified; the temporary Realtime smoke bid was cancelled at revision 4 with zero retained TRADER scope.
- Concurrency: not changed by this documentation-only task.

## Validation commands

Run `npm ci`, the full and production dependency audits, lint, typecheck, tests, build, foundation check, `git diff --check`, allowed-file diff, and status checks. Local Docker/database replay is not required solely for this documentation-only PR.

## Stop conditions

Stop for a dirty base tree, exact-base mismatch, inability to fast-forward local `main`, unexpected conflicting open PR, canonical-contract conflict, required out-of-scope file, or a validation hard-gate failure.

## Git and PR rules

Commit only the allowed documentation files, preferably as `docs: reconcile frontend realtime production rollout`; push the dedicated branch and open a Draft PR against `main`. Do not deploy, mark ready, merge, or delete branches.

## Completion report

Record the starting and final HEAD, exact changed files, per-document summary, validation and audit results, Draft PR and exact-HEAD CI state, deviations, confirmation of no out-of-scope changes, and confirmation that the PR was neither marked ready nor merged.

## Recommended model and reasoning

GPT-5.6 Terra / Medium. This is a bounded documentation reconciliation after independently verified rollout facts.

## Owner approval point

After documentation validation, push, and Draft PR creation, stop for owner review of the exact diff and CI. No production, access-state, deployment, or merge action is authorized.
