# AI Task Card — PR #30 Manual `.msg` Bidding Intake Phase 1

## Repository and Git state

- Repository: `https://github.com/daniel-oh55/bunker_bidding_system_skrhal.git`
- Base branch and exact base SHA: `main@0066cc0f7b17863f8c9692159696b3d4aa24ff6e`
- Working branch: `feat/pr-30-manual-msg-bid-intake`
- Target PR and expected HEAD: Draft PR #30 against `main`; final HEAD to be recorded at handoff
- Working tree status: clean at preflight; no merge, rebase, cherry-pick, or revert in progress

## Current migration state

- Repository migrations: seven existing migrations through `20260808090000_realtime_workspace_notifications.sql`; unchanged by this PR
- Local clean-replay status: blocked for this frontend-only PR because another local Supabase project (`ai-family-investment-os`) owns port `54322`; no foreign container was stopped, no partial container for this repository remained, and GitHub CI is the database gate
- Remote applied status: not queried or inferred; no remote Supabase project is linked or changed by this PR

## Single purpose

Add a BUYER-only, browser-local manual Outlook `.msg` intake flow that produces a review draft and can populate the existing bid form only after an explicit human Apply action.

## Protected business invariant

An imported message is untrusted advisory input, never authority. Selecting, parsing, previewing, or applying it cannot create a bid or invoke any server operation. Only the user's explicit submission of the visible, editable existing form may reach the unchanged `createBid` RPC boundary. Imported data never sets the bid deadline or responsible BUYER.

## Actor and action matrix

| Actor | Precondition | Read | Create | Update | Transition | Expected result |
| --- | --- | --- | --- | --- | --- | --- |
| Active BUYER | Existing server-verified BUYER workspace is mounted | Select and parse one local valid `.msg`; review draft/warnings | Existing explicit Create bid action only | Apply usable candidates to the visible form and edit them | None | Local draft remains advisory until explicit form submission |
| Active BUYER | Invalid, oversized, malformed, or unsupported file/input | Sanitized validation or parsing error only | Denied | Existing form remains editable | None | No parser exception/content leak and no server call |
| TRADER | Any state | No intake UI | Denied | Denied | Denied | Existing TRADER workspace remains unchanged |
| Unauthenticated, inactive, or suspended user | No authorized BUYER workspace | No intake UI | Denied by existing access boundary | Denied | Denied | Existing fail-closed authorization remains unchanged |
| Imported message content | Untrusted local bytes/text | May supply conservative candidates only | Never | Never sets deadline/responsible BUYER; never submits | Never | Ambiguity is warned, not guessed |

## Enforcement layers

| Rule | Constraint | RLS | RPC/server function | Application UX |
| --- | --- | --- | --- | --- |
| Bid creation authority | Existing database constraints unchanged | Existing policies unchanged | Existing `createBid` RPC remains sole creation path | Import controls never submit; existing Create bid submits visible state |
| File boundary | Exactly one case-insensitive `.msg`, at most 5 MiB, valid CFBF signature | Not applicable | No endpoint or upload | Validate before `MsgReader`; sanitize failures |
| Parsed data boundary | Expose normalized subject/body only; no HTML, attachment, identity, or hidden authority | Not applicable | Not applicable | Preview candidates/warnings; explicit Apply required |
| Deadline and responsibility | Never imported or inferred | Existing enforcement unchanged | Existing validation unchanged | Apply leaves deadline and responsible BUYER untouched |
| Fuel parsing | Only explicit supported aliases with positive finite MT quantity | Existing constraints unchanged | Existing validation unchanged | Unsupported, malformed, or conflicting values warn and are not guessed |

## Allowed files

- `PROJECT_STATE.md`
- `docs/PRODUCT_AND_SCOPE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_TASK_CARD_PR_30.md`
- `package.json`
- `package-lock.json`
- `src/bidding/bid-form.tsx`
- `src/bidding/bid-form.test.tsx`
- `src/bidding/bid-intake.ts`
- `src/bidding/bid-intake.test.ts`
- `src/bidding/msg-intake.ts`
- `src/bidding/msg-intake.test.ts`
- `src/styles.css`

## Forbidden scope

- No Auth, membership, RLS, RPC, Realtime, Supabase, Vercel, TRADER, or legacy changes
- No server endpoint, mailbox connection, `.eml` support, polling, webhook, automatic ingestion, automatic creation, or historical migration
- No secrets, Node polyfills, additional dependencies, real messages, operational fixtures, HTML rendering, attachment extraction, URL fetching, browser persistence, or uploads

## Database and migration plan

No database or migration changes. The repository migration set, local migration state, and remote applied history remain separate and unchanged.

## Test scenarios

- Positive, denial, and cross-organization cases: deterministic subject/body parsing; explicit body-field precedence; supported fuel aliases; partial drafts; file extension/size/signature gates; explicit Apply; editable visible values; explicit submit only. TRADER and cross-organization behavior are structurally unchanged because the intake is contained in the existing BUYER form component.
- Client-claim bypass, inactive/suspended, and privilege cases: no new claims or authority are introduced; existing server-verified workspace mounting and `createBid` RPC remain the boundary. Tests prove file selection, parsing, failure, and Apply do not invoke submission.
- Concurrency cases where relevant: not applicable to browser-local draft state; existing server revision/concurrency tests must continue to pass.
- Denial and bypass cases: generic MGO, unsupported lines, non-positive/malformed quantities, duplicate conflicting quantities, invalid binary headers, oversized/wrong-extension files, and parser exceptions produce warnings/errors without guessing or server activity.

## Validation commands

Run `npm ci`, all specified audit commands, lint, typecheck, full Vitest suite, build, foundation boundary check, diff checks, and the repository's local Supabase start/reset/test/stop sequence when Docker is available.

## Stop conditions

Stop for a dirty tree or base mismatch; a conflicting open PR; any required file outside the allowed list; need for another dependency or Node polyfill; parser incompatibility with Vite/typecheck/build; material dependency expansion; production high/critical audit finding; migration-history mismatch; unexpected operational data; or conflict with a canonical contract.

## Git and PR rules

Create one commit with the single purpose, push only the feature branch, and open a Draft PR titled `feat: add manual msg bid intake` against `main`. Do not mark ready, merge, deploy, alter Production, or delete branches.

## Completion report

Record preflight, starting/final HEAD, exact files, pinned dependency, audits, input and parsing contracts, non-imported deadline/responsibility, absence of HTML/attachment/server activity, unchanged RPC, tests/checks, Draft PR and exact-head CI/Vercel state, optional sanitized binary smoke, deviations, and no merge/deploy/Production mutation.

## Recommended model and reasoning

GPT-5.6 Terra with high reasoning, as requested for untrusted binary parsing and preservation of the authorization boundary.

## Owner approval point

The Draft PR is the handoff boundary. Owner review is required before readiness, merge, deployment, any Production action, or use with operational `.msg` files.
