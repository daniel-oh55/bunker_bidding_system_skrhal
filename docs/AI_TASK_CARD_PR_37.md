# AI Task Card - PR #37

## Repository and Git state

- Repository: `daniel-oh55/bunker_bidding_system_skrhal`
- Base branch and exact base SHA: `origin/main` at `6ff35957e757cf429e316b977e897ba0f2387320`
- Working branch: `fix/pr-37-gmail-spot-subject-eligibility`
- Target PR and expected HEAD: Draft PR #37; final implementation commit pending
- Working tree status: clean before this task card

## Current migration state

- Repository migrations: unchanged; ten migrations remain in the repository.
- Local clean-replay status: pending repository-required validation.
- Remote applied status: not inferred; no remote project is linked or changed.

## Single purpose

Require the existing server-only Gmail IMAP connector to accept only messages whose original envelope subject begins at its first character with the exact case-sensitive ASCII prefix `//SPOT//`, without changing the business parser or response shape.

## Protected business invariant

Only an exact leading `//SPOT//` marker on the untrimmed IMAP envelope subject permits body download, `parseBunkerRequest()`, or normalized ingest. Filtered messages remain discovered but are neither absent nor errors and may be passed only by the existing single cursor CAS after the complete snapshot succeeds. Eligible mail keeps the normalized full marked subject for storage while the parser receives the subject with exactly the leading marker and immediately following whitespace removed.

## Actor and action matrix

| Actor/message | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Unauthorized caller | Missing/wrong trigger secret or non-POST | None | None | None | None | Existing fixed denial before privileged work |
| Authorized connector, exact-prefix message | Original subject starts with `//SPOT//` | Metadata and selected bounded inline plaintext | Existing normalized ingest RPC | None | Existing cursor CAS after full success | Ingest once; stored subject retains marker; parser subject excludes marker |
| Authorized connector, filtered message | Subject is ordinary, prefixed by whitespace/reply text, or wrong case | Eligibility metadata only | None | None | Existing cursor CAS after full success | Discovered, not absent/error, no body download or ingest |
| Definitively absent snapshot UID | Existing bounded snapshot entry is absent | Existing absence determination | None | None | Existing cursor CAS after full success | Existing `skipped_absent` behavior unchanged |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Exact subject eligibility | No database change | Existing queue controls unchanged | Connector checks original envelope subject before body selection/download, parsing, or ingest | None |
| Marked subject persistence and parser isolation | Existing normalized ingest bounds | Existing queue controls unchanged | Full normalized subject is stored; only the parser input removes the leading marker and following whitespace | Existing queue UI unchanged |
| Snapshot and cursor semantics | Existing cursor schema unchanged | Existing cursor controls unchanged | Explicit internal `ingested`/`filtered`/`absent` result; one CAS only after successful handling | Response shape unchanged |

## Allowed files

- `supabase/functions/_shared/gmail-mail-intake.ts`
- `supabase/functions/tests/gmail-mail-intake.test.ts`
- `docs/AI_TASK_CARD_PR_37.md`
- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`

## Forbidden scope

No adapter, dependency, configuration, migration, frontend, parser grammar, bid creation, legacy, deployment, Production, live Gmail, secret, real-data, cursor reset, cron, or unrelated refactor work.

## Database and migration plan

No migration or database change. Reuse the existing ingest and cursor RPC contracts without linking or inspecting a remote project.

## Test scenarios

- Positive: exact marked subjects ingest; stored subject retains `//SPOT//`; parser-derived vessel/voyage exclude the marker.
- Denial/bypass: ordinary, reply-prefixed, leading-whitespace, and lowercase markers fetch no body and do not ingest or increment `skipped_absent`.
- Mixed snapshot: exact markers ingest, filtered messages skip body work, definitive absence remains counted, and one CAS advances to the captured upper UID.
- Existing trigger, MIME, size, `INTERNALDATE`, UIDVALIDITY, retry, conflict, root-text, and failure regressions remain green.
- Concurrency: existing serialization retry and cursor CAS conflict coverage remains authoritative; no new concurrency mechanism is introduced.

## Validation commands

Run `npm ci`; all specified npm audits; `npm run test:edge`; lint, typecheck, unit tests, build, foundation check, and `git diff --check`; then the repository database start/reset/test/stop sequence when Docker is available.

## Stop conditions

Stop for base SHA movement, an overlapping PR, unrelated dirt, migration or disallowed-file need, parser grammar change, blocking audit result, credential or operational-data exposure, or any Production requirement.

## Git and PR rules

Prefer one implementation commit; push only the working branch; open but do not ready, merge, or deploy Draft PR #37. Report any GitHub-assigned number mismatch.

## Completion report

Record preflight, starting and final HEAD, commit, exact files, implementation, validations and audit classification, Draft PR state, prohibited-action confirmation, and deviations.

## Recommended model and reasoning

High reasoning with independent security/risk review because this changes connector eligibility ahead of privileged ingest and cursor advancement.

## Owner approval point

Any Production action, remote link, secret registration, live Gmail access, migration, parser grammar change, deployment, merge, or scope expansion requires owner approval.
