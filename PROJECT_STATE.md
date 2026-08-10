# PROJECT STATE

## Rolling state

- Current baseline: trusted organization labels are server-sourced presentation data in the access context and frontend workspace
- Active frontend baseline: React + Vite + TypeScript sign-in-only access gate and integrated BUYER/TRADER workspace
- Active backend baseline: local migrations, pgTAP database tests, and server-authorized bid, quote, award, scope, and audit RPCs
- Legacy reference location: `legacy/firebase-prototype/`

## Fixed contracts

- Firebase data and accounts are not being migrated.
- Roles are `buyer_admin`, `buyer_operator`, and `trader`.
- Public signup is not allowed.
- Approved BUYER accounts may number three or more.
- Every approved BUYER will be able to see all bids and all quotes, with views for all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access will require verified membership in an approved organization and will be limited to explicitly allowed bid and quote scope.
- Authorization will never trust `user_metadata` or other unverified client claims.
- Accounts, organizations, memberships, and the fail-closed current-access-context RPC are implemented in PostgreSQL. The RPC includes a trimmed, server-sourced organization label as presentation data only.
- Suspended or inactive users will immediately lose access.
- `created_by` will be immutable and kept separate from the actor performing update, close, reopen, award, or cancel operations.
- Deadlines will use server time, and quote creation or modification after close will be rejected server-side.
- Close, reopen, award, and cancel will be server-side transactional operations.
- Browser code will use only the Supabase publishable key.
- Secret and service-role credentials will never enter browser code, Vite variables, or the repository.
- The frontend authorized shell requires at least one context returned by `public.current_access_context()`; an Auth session alone is insufficient.
- Bids use raw `open`, `closed`, `awarded`, and `cancelled` states. Raw open with a non-null passed deadline is effectively closed using server time; no cron transition exists.
- Details are editable only while effective-open. After an organization quote exists, commercial terms and quantities are immutable; a real future/null deadline-only update remains possible.
- `created_by` is immutable. Cross-BUYER updates and responsibility changes record the actual actor and before/after state in append-only audit history.
- Reassignment is allowed for raw open/closed bids, not cancelled or awarded bids. Reopen requires a null or future deadline and preserves quotes; cancellation and award are irreversible in V1.
- TRADER organizations receive explicit current per-bid scope. Each organization owns one quote, active members collaborate, and scope revocation immediately removes TRADER visibility/write access without deleting retained quotes.
- BUYERs see all quotes. TRADERs do not receive competitor scope or quote data. Award is server-side and terminal in V1. The integrated BUYER/TRADER frontend workspace is implemented; it uses server RPCs, manual refresh, and post-mutation reload. Private Realtime Broadcast invalidation is implemented as a foundation; Realtime UI delivery remains unimplemented.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Implemented baseline

- The PR #1 application foundation is complete.
- Local Supabase migration replay and pgTAP database tests run locally when Docker is available and in GitHub CI.
- `app_private` contains private account, organization, and membership authorization data. The authenticated public RPC returns only active, server-verified membership context plus a trusted organization label that does not authorize access.
- A sign-in-only frontend Auth boundary hydrates browser sessions, rechecks the RPC on Auth changes, preserves all returned contexts, and fails closed for missing configuration, zero context, stale requests, transient errors, and malformed present labels. It accepts the old four-field access-context shape only as a safe deployment-order fallback.
- Unit tests cover the frontend state machine. A loopback-only integration harness uses elevated local access only for fixture setup and cleanup while normal sign-in and RPC calls use the publishable key.
- Seven reviewed migrations, including `20260807010000_current_access_context_organization_label` and `20260808090000_realtime_workspace_notifications`, are applied to the approved Supabase Production project. The reviewed five-field `current_access_context()` contract, its fixed search-path `SECURITY DEFINER` boundary, and authenticated execute privilege were verified after application; remote public signup and anonymous access are disabled.
- The reviewed backend private Realtime Broadcast authorization foundation is applied in Production. Realtime service is enabled, public channel access is disabled, and private channels are enforced.
- Controlled initial provisioning is complete with three active BUYER identities, two active TRADER identities, one active BUYER organization, two active TRADER organizations, and five active compatible memberships.
- All five provisioned identities successfully authenticated and returned only their expected server-verified `current_access_context`; each passed an account- or membership-disable fail-closed check and was restored.
- The canonical Vercel Production project and Production domain are deployed from `main`; the duplicate Vercel project was removed.
- Supabase Site URL and the single exact Production redirect URL are configured.
- Sanitized Production lifecycle smoke testing is complete: synthetic bid creation and deadline update; cross-BUYER visibility and filters; explicit single-TRADER scope and second-organization isolation; one synthetic quote with a server-authoritative total; effective close by server deadline; quote response boolean correction; terminal award; award audit and revision transition; selected TRADER visibility and non-scoped TRADER isolation.
- The synthetic smoke fixture remains in Production as an awarded test record.
- Controlled Production UI smoke is complete for BUYER and TRADER: each displayed its trusted server organization label and entered its authorized workspace without using the UUID/neutral short-ID fallback.

## Not yet implemented

- No remote auth configuration push is authorized.
- Private Realtime Broadcast invalidation is applied as a backend foundation: active BUYER, organization-wide active TRADER, and self-only access topics are database-authorized. Bid-scope revocation emits one final invalidation without revoking an active organization topic; existing RPCs remain the authoritative source for bid and quote data and authorization. Frontend Realtime subscription, automatic refresh, and UI delivery remain unimplemented; the frontend continues to use manual refresh and post-mutation server reload.
- Invitations and administration/provisioning flows and UI.

## Completed refinements

- The BUYER bid detail uses a compact always-visible overview with accessible disclosure sections for bid terms and deadline, responsibility and lifecycle, TRADER access and quotes, and audit history.
- Audit responsibility transitions show active BUYER display labels when available and a shortened neutral identifier when the BUYER is inactive or unavailable.
- Destructive TRADER scope revocation requires a target-bound, two-step BUYER confirmation. Selected awarded organizations receive an explicit award-result visibility warning; the server terminal-revocation contract remains unchanged.
- Membership selectors and context chips present the trusted server organization label when available, while membership IDs remain the identity and authorization input.
- Existing Auth users can request password recovery. A `PASSWORD_RECOVERY` session is recovery-only, preempts access verification, never opens a workspace, and is locally signed out after a successful password update; normal sign-in still requires server-verified membership.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
