# Architecture

## Current shape

- Browser app: React + Vite + TypeScript
- Supabase access: local CLI migrations and pgTAP tests; all nine canonical migrations are applied to Production, including `20260821070000_mail_intake_foundation` and `20260821100000_mail_intake_ingress_hardening`
- Authorization data: private `app_private` PostgreSQL schema with account, organization, and membership tables
- Frontend access coordination: sign-in and password-recovery state machine backed by `public.current_access_context()`, an integrated RPC-only BUYER/TRADER workspace with isolated BUYER mail-intake list/dismiss state, and a private Realtime invalidation adapter
- Local intake: a BUYER form-local `.msg` binary adapter validates extension, size, and CFBF signature before browser parsing; a separate pure parser converts only plain-text subject/body into advisory candidates and warnings
- Server intake foundation: a future trusted mailbox connector may call one service-role-only normalized-ingress RPC, which stages bounded candidates in an RLS-enabled `app_private` queue; the BUYER frontend uses only narrow authenticated list/dismiss RPCs and exposes no ingest surface
- Production baseline: controlled BUYER/TRADER provisioning, canonical Vercel Production deployment, sanitized synthetic lifecycle smoke testing, BUYER/TRADER trusted-label UI smoke, private Realtime channel enforcement, E2E verification of the existing private Realtime adapter, and mail-intake privilege verification are complete. The Supabase service role is ingest-only, `authenticated` is list/dismiss-only, `anon` has no mail-intake RPC access, direct queue CRUD is denied, and the queue was empty after rollout.
- Legacy reference: static Firebase prototype under `legacy/firebase-prototype/`

## Implemented authorization baseline

- Auth user creation provisions an inactive private account only; it never grants membership or active access.
- `public.current_access_context()` derives all context from current database rows and fails closed unless account, organization, and membership are active. Its fifth output is a trimmed organization label from that active organization row.
- The browser uses a publishable key only, hydrates the session, and renders the minimal authorized shell only when the RPC returns at least one context.
- Auth changes trigger context revalidation, all returned memberships are preserved, and obsolete async results cannot restore access after sign-out.
- A Supabase `PASSWORD_RECOVERY` event creates a recovery-only state that cancels access work, ignores unrelated Auth events, and permits only password update followed by local sign-out; it never invokes the access-context RPC or mounts a workspace.
- The browser does not receive direct access to private authorization tables.
- The loopback-only integration harness uses elevated local access only to prepare and delete fixtures. Its sign-in and RPC assertions use the normal publishable client.
- Bid records, fuel items, and audit events are private RLS-enabled tables. Public bid RPCs verify the selected active BUYER membership server-side and use row locks plus revisions for every non-create mutation.
- Audit events are append-only and contain server-generated before/after snapshots, actor membership/organization/role snapshots, and the resulting revision.
- Bid/TRADER scope is a private current access relation. Quotes and quote items are private, RLS-enabled organization-owned records; public RPCs authenticate the selected membership from `auth.uid()` and database state before every access.
- Quote mutation and award lock the bid first, use database server time for closure, calculate totals from stored bid quantities and quote prices, and append server-generated audit snapshots. The composite award foreign key proves the award quote belongs to its bid.
- Mail intake identity is a unique `(source_provider, source_mailbox_key, source_message_id)` tuple. The opaque mailbox/message values stay private; duplicate ingress returns the existing ID without updating candidates, status, or revision, including when the item is dismissed. Deterministic READ COMMITTED regressions cover the unique-index wait/recheck path when the first ingest commits and when it rolls back.
- `public.list_mail_intake_items()` exposes only the shared pending queue after the existing active-BUYER actor check. `public.dismiss_mail_intake_item()` locks one row, verifies the expected revision and pending state, records the server-verified actor, and transitions it one way to dismissed.

## Enforced architectural boundaries

- browser code uses only the Supabase publishable key
- secret and service-role credentials never enter browser code, Vite variables, or the repository
- elevated authorization decisions are made by PostgreSQL policies and server-side functions without trusting `user_metadata` or unverified client claims
- access checks immediately reject suspended or inactive users
- deadlines use server time, and quote creation or modification after close is rejected server-side
- close, reopen, award, and cancel are server-side transactional operations
- immutable creation identity is stored in `created_by`, separately from the actor performing later update, close, reopen, award, or cancel operations
- PostgreSQL constraints or transactional functions are authoritative for data invariants.
- RLS or server-side RPC/functions are authoritative for row and operation authorization.
- Application validation mirrors server rules only for UX.
- Manual `.msg` intake is an application-only draft adapter, not an authorization or persistence layer. Preview and Apply make no network or RPC calls; the existing visible create form and unchanged `createBid` RPC remain the only bid creation path.
- The intake layer keeps source bytes and normalized plain text ephemeral, exposes no HTML/attachments/message identities, performs no URL fetches, and never imports deadline or responsible-BUYER authority.
- The server-side intake foundation is separate from browser-local parsing. Its elevated connector role may call only normalized `SECURITY DEFINER` ingress among the three public mail-intake RPCs and has no direct private-table CRUD; `anon` and `authenticated` have no ingest EXECUTE or direct private-table access. Authenticated active BUYERs retain list/dismiss RPC access. BUYER results omit provider/mailbox/message identity and expose only bounded candidates, warnings, status, revision, and server timestamps.
- No provider connector, OAuth/token/password handling, mailbox fetch, polling, webhook, cron, automatic bid creation, or intake-to-bid conversion exists. `received_at` is provider-originated metadata, never deadline authority, and the existing `createBid` contract is unchanged.
- Private Realtime Broadcast is an authorization-checked invalidation foundation, not an authorization mechanism. Active BUYER contexts may join `workspace:buyer`; active TRADER members may join only their organization-wide `workspace:trader:<organization_uuid>` topic; authenticated users may join only their own `workspace:access:<auth_user_uuid>` topic. Browser clients have no application Broadcast send policy.
- Realtime service is enabled in Production with public channel access disabled, so those Broadcast topics are enforced as private channels.
- The Broadcast application payload is only `{"kind":"workspace_changed"}` or `{"kind":"access_changed"}`; Realtime adds its own opaque delivery ID. No bid, quote, organization, or identity data is placed in the application payload.
- Bid-specific visibility and mutation authority remain in the existing RPC/server functions. A bid-scope revoke sends one final invalidation to the removed organization, then later changes to that bid no longer fan out there. The active member can still join its organization topic and receive notifications for other current bid scopes.

## Enforced access contracts

- Approved BUYER accounts may number three or more.
- Every approved BUYER can see all bids and all quotes.
- BUYER views support all bids, bids created by the current BUYER, and filtering by BUYER.
- TRADER access requires verified membership in an approved organization and is limited to explicitly allowed bid and quote scope.

The browser creates separate access, bidding, and narrow Realtime invalidation adapters from the same publishable client; React never receives the raw client. Membership selection is constrained to active server-returned contexts and uses a keyed workspace boundary, which clears data on a context switch. The Realtime adapter opens only private channels: one `workspace:access:<auth_user_uuid>` channel and one selected-context business channel (`workspace:buyer` or `workspace:trader:<selected_organization_uuid>`). It accepts only the exact corresponding event and marker kind, and exposes no send, arbitrary topic, Presence, or data-payload interface. Production E2E verification confirmed that its existing callbacks prompt BUYER and selected-TRADER authoritative reloads, retain competitor isolation, and cause an `access_changed` membership deactivation to fail closed. Access invalidation reuses the access recheck path; business invalidation reuses existing authoritative workspace reloads while manual Refresh and post-mutation reload remain fallback paths. Each RPC result is runtime-validated, mutations use server revisions, authorization failures clear protected data before context revalidation, and stale operations are ignored. Recovery routing uses only the application's origin/root and a recovery session is never workspace authorization. TRADER screens call only their own bid and quote RPCs, so competitor data is not requested. Signup, invitation, provisioning, and admin workflows remain unimplemented. The frontend gate and Realtime delivery are best-effort UX/state coordination, not substitutes for RLS or server functions.

## Foundation boundaries

- no active Firebase runtime usage
- local SQL migrations and database tests are permitted only in their dedicated Supabase directories
- nine reviewed Supabase migrations, including canonical mail-intake versions `20260821070000` and `20260821100000`, are applied and the canonical Vercel Production deployment exists
- no real operational bidding data has been migrated or is in use; retained Production records are synthetic smoke records only
- manual browser-local `.msg` draft intake, the private normalized server intake boundary, and the active-BUYER provider-neutral pending list/dismiss UI are allowed. Provider connectors, OAuth/token/password handling, live mailbox connectivity/fetch/delivery, polling/webhook/cron, manual `.eml`, intake-to-bid conversion, automatic bid creation, historical email migration, and operational email fixtures remain outside the architecture; no real operational mail data was introduced
- a future connector must tolerate unique-index lock waits and treat SQLSTATE `40001` as retryable if it adopts stronger isolation or otherwise receives a serialization failure; the unique source constraint remains the authoritative identity boundary
