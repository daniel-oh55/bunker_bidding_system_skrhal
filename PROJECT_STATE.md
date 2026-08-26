# PROJECT STATE

## Rolling state

- Current baseline: trusted organization labels are server-sourced presentation data in the access context and frontend workspace; BUYER bid creation supports advisory browser-local `.msg` draft intake; the BUYER frontend exposes the provider-neutral shared pending mail-intake queue through narrow list/dismiss RPCs; and the server-only Gmail connector is active in Production
- Active frontend baseline: React + Vite + TypeScript sign-in-only access gate and integrated BUYER/TRADER workspace
- Active backend baseline: eleven local migrations, pgTAP database tests, server-authorized bid, quote, award, scope, and audit RPCs, plus backend-only normalized mail ingress, active-BUYER queue RPCs, provider-neutral connector cursor RPCs, and the restored polling-extension migration
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
- A manually selected local `.msg` may supply review-only BUYER form candidates. Parsing and Apply are never authority or creation actions; the existing explicit Create bid action and `createBid` RPC remain the sole creation path.
- The provider-neutral server-side mail intake foundation stores only bounded normalized candidates in a private queue. The elevated connector role is intentionally ingest-only through the `SECURITY DEFINER` RPC: it has no list/dismiss EXECUTE and no direct queue SELECT/INSERT/UPDATE/DELETE. Every active approved BUYER retains shared pending visibility and dismissal through server-verified RPC authorization; TRADERs have no access.
- Mail intake never retains raw body, HTML, attachments, sender/recipient/address fields, provider credentials, deadline, or responsible BUYER, and never creates bids. The Gmail connector analyzes only bounded inline plain text in memory. Opaque provider/mailbox/message identity is used only for non-overwriting idempotency and is not exposed in BUYER results.
- Secret values and backend credentials will never enter browser code, Vite variables, repository source values, logs, or test output. Server-only code may reference expected runtime variable names without values.
- The frontend authorized shell requires at least one context returned by `public.current_access_context()`; an Auth session alone is insufficient.
- Bids use raw `open`, `closed`, `awarded`, and `cancelled` states. Raw open with a non-null passed deadline is effectively closed using server time; no cron transition exists.
- Details are editable only while effective-open. After an organization quote exists, commercial terms and quantities are immutable; a real future/null deadline-only update remains possible.
- `created_by` is immutable. Cross-BUYER updates and responsibility changes record the actual actor and before/after state in append-only audit history.
- Reassignment is allowed for raw open/closed bids, not cancelled or awarded bids. Reopen requires a null or future deadline and preserves quotes; cancellation and award are irreversible in V1.
- TRADER organizations receive explicit current per-bid scope. Each organization owns one quote, active members collaborate, and scope revocation immediately removes TRADER visibility/write access without deleting retained quotes.
- BUYERs see all quotes. TRADERs do not receive competitor scope or quote data. Award is server-side and terminal in V1. The integrated BUYER/TRADER frontend workspace uses server RPCs, manual refresh, and post-mutation reload. It also consumes private Realtime Broadcast only as a best-effort invalidation: one self access topic revalidates server access and one selected-context topic triggers the existing authoritative workspace reload.
- Humans approve merges and deployments.
- Codex is intended for implementation support and Claude Code for parallel review.

## Implemented baseline

- The PR #1 application foundation is complete.
- Local Supabase migration replay and pgTAP database tests run locally when Docker is available and in GitHub CI.
- `app_private` contains private account, organization, and membership authorization data. The authenticated public RPC returns only active, server-verified membership context plus a trusted organization label that does not authorize access.
- A sign-in-only frontend Auth boundary hydrates browser sessions, rechecks the RPC on Auth changes, preserves all returned contexts, and fails closed for missing configuration, zero context, stale requests, transient errors, and malformed present labels. It accepts the old four-field access-context shape only as a safe deployment-order fallback.
- Unit tests cover the frontend state machine. A loopback-only integration harness uses elevated local access only for fixture setup and cleanup while normal sign-in and RPC calls use the publishable key.
- All eleven repository migrations are applied to the approved Supabase Production project, including the Gmail connector cursor migration and final `20260826010503_enable_gmail_polling_extensions` migration. The reviewed five-field `current_access_context()` contract, its fixed search-path `SECURITY DEFINER` boundary, and authenticated execute privilege were verified after application; remote public signup and anonymous access are disabled.
- The reviewed backend private Realtime Broadcast authorization foundation is applied in Production. Realtime service is enabled, public channel access is disabled, and private channels are enforced.
- Controlled initial provisioning is complete with three active BUYER identities, two active TRADER identities, one active BUYER organization, two active TRADER organizations, and five active compatible memberships.
- All five provisioned identities successfully authenticated and returned only their expected server-verified `current_access_context`; each passed an account- or membership-disable fail-closed check and was restored.
- The canonical Vercel Production deployment from `main` is live; the duplicate Vercel project was removed.
- Supabase Site URL and the single exact Production redirect URL are configured.
- Sanitized Production lifecycle smoke testing is complete: synthetic bid creation and deadline update; cross-BUYER visibility and filters; explicit single-TRADER scope and second-organization isolation; one synthetic quote with a server-authoritative total; effective close by server deadline; quote response boolean correction; terminal award; award audit and revision transition; selected TRADER visibility and non-scoped TRADER isolation.
- Controlled Production frontend Realtime smoke is complete. A BUYER automatically reloaded after `workspace_changed` from synthetic-bid creation; a selected TRADER automatically reloaded from zero to one accessible bid after an authorized scope grant; the non-scoped TRADER and other TRADER organization remained isolated. A controlled membership active-to-inactive transition delivered `access_changed`, removed protected workspace without manual refresh, and failed closed with no active authorized membership. Controlled access state was restored and normal sign-in reverified.
- Manual Refresh and the existing post-mutation authoritative reload remain fallback paths. The temporary Realtime synthetic bid was cancelled at revision 4 with zero retained TRADER scope; retained Production records are synthetic smoke records only.
- Controlled Production UI smoke is complete for BUYER and TRADER: each displayed its trusted server organization label and entered its authorized workspace without using the UUID/neutral short-ID fallback.
- Manual BUYER `.msg` intake is implemented as a browser-local, size/signature-gated parser followed by a parsed-draft preview, warnings, explicit Apply, and unrestricted human review/editing in the existing create form. Only normalized plain-text subject/body reach the conservative business parser; no import interaction invokes RPC, Auth, list, or Realtime work.
- Production privilege verification confirms the Supabase service role may execute mail ingest only, `authenticated` may execute list/dismiss but not ingest, `anon` has no mail-intake RPC access, and all three roles are denied direct queue CRUD. Controlled synthetic Gmail smoke rows were removed after verification; live operational intake may retain bounded normalized operational mail candidates.
- The BUYER workspace now lists, refreshes, and revision-safely dismisses provider-neutral pending mail candidates through the authenticated RPC adapter. Its state and failures are isolated from bid operations; dismissal is shared, irreversible, target-confirmed, and followed by an authoritative reload. No provider identity or intake-to-bid action is exposed.
- Deterministic CI regressions cover duplicate-ingest unique-index waits when the first transaction commits and when it rolls back under normal READ COMMITTED isolation. The active connector tolerates lock waits and treats SQLSTATE `40001` as retryable if it uses a stronger isolation path or otherwise receives a serialization failure; the unique source constraint remains authoritative.
- The active Production Gmail Edge Function uses only server-side IMAP over fixed TLS `imap.gmail.com:993` with an App Password, opens `INBOX` read-only, and has no OAuth/Gmail API or seven-day OAuth Testing-token dependency. Controlled Gmail/App Password setup, live mailbox connectivity, and initial high-water cursor initialization are complete; no historical mail was imported. Later runs snapshot the bounded UID range; only messages whose original envelope subject begins at its first character with the exact case-sensitive ASCII prefix `//SPOT//` may download bounded inline `text/plain`, reach the existing parser, and call normalized ingest. The stored normalized subject retains the marker, while parser subject input excludes exactly that leading marker and following whitespace. Filtered messages remain discovered, are not absent or errors, and may accompany the single successful revision CAS after the full snapshot. UIDVALIDITY changes, every hard IMAP/processing failure, and cursor conflict fail closed without reset, rescan, or advance; a definitively missing UID is counted only in a bounded aggregate and may accompany an otherwise successful advance.
- The connector is POST-only and uses its dedicated trigger header before IMAP, database, or cursor work. `verify_jwt = false` intentionally permits server-to-server invocation, but browser JWTs confer no authority. Production secrets remain server-side and must never be committed.
- Production polling is active every five minutes through `pg_cron` to `pg_net` to the Gmail Edge Function. The Cron command obtains the project URL and connector trigger secret at runtime from Supabase Vault entries named `gmail_connector_project_url` and `gmail_connector_trigger_secret`; their values remain owner-controlled Production configuration outside repository migrations.
- Manual connector E2E, the exact `//SPOT//` eligibility re-smoke, and automatic scheduled-polling smoke verification are complete. Non-SPOT synthetic mail created no queue row, exact-marker synthetic mail created one normalized row, and the synthetic smoke rows were cleaned up after verification. Mail intake remains BUYER review/dismiss only and never creates or converts a bid automatically; TRADERs have no mail-intake access.

## Not yet implemented

- No remote auth configuration push is authorized.
- Invitations and administration/provisioning flows and UI.
- Microsoft Graph, manual `.eml` intake, webhook delivery, automatic historical mailbox import, intake-to-bid conversion or automatic bid creation, and historical `.msg`/`.eml` migration.

## Completed refinements

- The BUYER main bid presentation is a full-width responsive operational board: each bid card places its server-returned summary above a per-bid table of BUYER-visible quotes loaded only through `listQuotesForBuyers`. Requested fuel columns follow bid fuel-item order, `total_amount` remains server-authoritative, and retained inactive or ineligible quotes remain visible with status metadata. The displayed lowest eligible offer and gap are advisory only; award remains manual through the existing server-authorized detail flow, which opens below the board. Board quote loads use bounded concurrency, isolate non-authorization failures, fail closed on authorization failures, and reject superseded view, membership, and reload results. No authorization scope or backend contract changed.
- Final BUYER/TRADER workspace presentation polish strengthens operational hierarchy, quote comparison scanning, editor/read-only distinction, terminal results, responsive behavior, and keyboard/focus presentation without changing backend, authorization, deadline, award, quote, or Realtime contracts.
- The BUYER All bids view groups and locally collapses bids by immutable creator; Created by me, responsible-BUYER filtering, and all authorization, lifecycle, RPC, and Realtime contracts remain unchanged.
- BUYER quote-board comparison and BUYER/TRADER deadline countdown presentation are implemented; award, quote, authorization, deadline, and Realtime contracts are unchanged.
- The TRADER workspace UX refinement is implemented without changing quote, authorization, deadline, RPC, or Realtime contracts.
- The BUYER workspace presents human-readable server-backed views, authoritative-list summary counts, dense selectable bid cards, and clearer create/detail operation grouping without changing RPC, authorization, lifecycle, or Realtime behavior.
- BUYER and TRADER workspaces share presentational summary, status-badge, and empty-state primitives with a restrained responsive operational UI foundation. These components do not own membership authority, data access, mutations, or Realtime behavior.
- The BUYER bid detail uses a compact always-visible overview with accessible disclosure sections for bid terms and deadline, responsibility and lifecycle, TRADER access and quotes, and audit history.
- Audit responsibility transitions show active BUYER display labels when available and a shortened neutral identifier when the BUYER is inactive or unavailable.
- Destructive TRADER scope revocation requires a target-bound, two-step BUYER confirmation. Selected awarded organizations receive an explicit award-result visibility warning; the server terminal-revocation contract remains unchanged.
- Membership selectors and context chips present the trusted server organization label when available, while membership IDs remain the identity and authorization input.
- Existing Auth users can request password recovery. A `PASSWORD_RECOVERY` session is recovery-only, preempts access verification, never opens a workspace, and is locally signed out after a successful password update; normal sign-in still requires server-verified membership.

## Notes

Keep this file focused on current state and durable contracts. Do not turn changing branch metadata, dates, PR numbers, or commit SHAs into hardcoded invariants.
