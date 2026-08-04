# Release And Operations Runbook

This runbook is a placeholder-only handoff for an owner-approved release. It does not authorize deployment, remote linking, user provisioning, secret registration, or real-data operations. Replace placeholders only in the approved operator session; never commit their values.

## Approval and separation of duties

An owner must approve each remote or production action below in writing: selecting a remote project, `supabase link`, configuration push, database push, Vercel import or promotion, user activation, organization or membership changes, and any incident recovery. Record the approver, time, target environment, intended project reference, migration review, validation evidence, and recovery decision in the approved change record.

The operator must confirm that `<PROJECT_REF>` is the intended organization-owned project and that the command is aimed at the intended environment before every remote command. Do not use a personal, test, or unknown project. Never place project IDs, URLs, emails, tokens, publishable keys, secret keys, service-role credentials, or bidding data in this document, source control, shell history shared with others, or CI logs.

## Local and CI release validation

Run the local release candidate checks from a clean checkout using the committed lockfile:

```bash
npm ci
npm audit --json
npm audit --audit-level=critical
npm audit --omit=dev --audit-level=high
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run check:foundation
git diff --check
```

When Docker is available, also run `npm run db:start`, `npm run db:reset`, `npm run db:test`, the membership/bid/quote concurrency scripts with local placeholders, the Auth and quote integration scripts with local placeholders, then `npm run db:stop`. Do not print elevated fixture values. Confirm the matching CI jobs ran against the exact candidate SHA and that full-tree critical and production high-or-critical audit findings are absent.

## Remote Supabase release procedure

1. Obtain owner approval to select `<PROJECT_REF>`. In the Supabase Dashboard, independently verify the organization, project name, environment label, and expected region against the approved change record.
2. From a clean, reviewed checkout, run `supabase link --project-ref <PROJECT_REF>` only after that verification. Confirm the CLI reports `<PROJECT_REF>`; do not link an unapproved project.
3. Run `supabase migration list` and compare repository migrations, local clean-replay evidence, and remote applied history. Stop on a mismatch or an unexplained remote migration.
4. Run `supabase db push --dry-run`, review the exact forward migration plan, and attach it to the approval record. A dry run is not permission to apply it.
5. After separate owner approval, review the proposed configuration and run `supabase config push`. Confirm the target remains `<PROJECT_REF>` and record the result.
6. After separate owner approval, run `supabase db push`. Re-run `supabase migration list` and the approved smoke checks. Never rewrite an applied migration and never use `supabase db reset --linked` in any remote environment.
7. In the remote Auth configuration, verify public/email signup is disabled and anonymous sign-in is disabled. Record the dashboard evidence and timestamp; the frontend has no control that can compensate for an unsafe remote Auth setting.

## Controlled access provisioning

Create Auth users only through an owner-approved, controlled administrator action in the remote Auth console or approved administrative process. Do not use public signup, an application provisioning UI, a browser-held service credential, or an unreviewed script.

For each approved `<USER_UUID>`, use an owner-approved, audited database-administration session to verify the newly provisioned inactive account row, then activate it only after identity and organization approval:

```sql
select user_id, status from app_private.user_accounts where user_id = '<USER_UUID>'::uuid;
update app_private.user_accounts set status = 'active' where user_id = '<USER_UUID>'::uuid;
```

Create and activate BUYER or TRADER organizations only in that controlled session, using placeholders such as `<BUYER_ORGANIZATION_UUID>` and `<TRADER_ORGANIZATION_UUID>`. Create only compatible active memberships: BUYER roles (`buyer_admin` or `buyer_operator`) belong to active BUYER organizations, and the `trader` role belongs to an active TRADER organization. Verify every insert/update and retain the approval evidence.

Initial production provisioning requires owner approval for at least three distinct approved BUYER users and representative active TRADER organizations. For each, create the Auth user, activate `app_private.user_accounts`, create or confirm the correct organization, and create the compatible active membership. Do not substitute client metadata for these records.

For each provisioned identity, authenticate as that user and call `public.current_access_context()`. Confirm it returns only the expected active membership context. Suspend an account or membership in the controlled session and confirm access fails closed before completing the procedure.

## Vercel discovery, preview, and promotion

After owner approval, discover or import the intended Vercel project through the Vercel dashboard or approved CLI session. Local `.vercel/` metadata is ignored by Git and must never be committed. Do not create or link a project as part of code review.

An existing Vercel Git Integration may automatically create or update a Preview deployment when a PR branch is pushed. Before release work, the owner must decide whether that automatic Preview behavior is approved or should be disabled in Vercel. An automatically generated Preview is not approval for Production promotion; independently verify Preview environment variables and access protection. This documentation does not authorize or perform a Vercel setting change.

Configure only these Preview and Production environment variable names:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Confirm each value points to the approved environment and that no secret, service-role, or elevated fixture credential is configured for the browser. Deploy a Preview only after the owner approves the target and environment values. Smoke-test sign-in and the relevant role contexts using controlled test identities. Promote to Production only after the owner approves the Preview evidence and exact candidate SHA.

## Smoke checks

Using controlled non-production-like identities in the target environment, verify:

- BUYER visibility covers all bids and retained quotes, including cross-BUYER views where authorized.
- TRADER visibility is limited to its currently scoped bid and its organization-owned quote; competitor quotes and scopes are absent.
- Server-time deadline closure rejects quote creation or update after effective closure.
- An eligible closed-bid quote can be awarded once, and the server audit shows the terminal award.
- Revoking current TRADER scope immediately removes TRADER read/write access while retaining appropriate BUYER quote visibility.
- Suspending an account or deactivating a membership immediately removes access after context revalidation.

Stop and investigate any result that differs from the server-authorized contract. Do not rely on frontend filtering as evidence of authorization.

## Incident response and recovery

For an authorization, confidentiality, audit, or lifecycle incident: stop affected releases; preserve timestamps, request identifiers, approved audit evidence, and minimal non-secret diagnostics; restrict access through an owner-approved account, membership, or organization change; and escalate to the owner. Do not alter audit history, expose credentials, or use production data in tickets.

Frontend rollback and database recovery are separate actions. With owner approval, use the Vercel deployment history to roll the frontend back to a previously approved deployment, then verify its environment variables and smoke checks. That rollback does not undo any remote database migration.

For database recovery, stop and review the applied migration history and incident impact. Use a reviewed, data-preserving forward migration with explicit owner approval; do not rewrite or delete applied migrations. Validate the forward recovery in local replay and CI before a remote dry run and owner-approved application.
