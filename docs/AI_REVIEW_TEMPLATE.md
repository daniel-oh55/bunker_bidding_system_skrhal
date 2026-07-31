# AI Review Template

## Review target

State repository, base, branch, PR, HEAD, and whether this is a full-PR or delta review.

## Preflight

Record repository and Git verification. This is a read-only review: no repository mutation.

## Verdict

`APPROVE`, `CHANGES REQUIRED`, or `BLOCKED`.

## Findings

List P0, P1, P2, and P3 findings with exact file and line references. Separate code reasoning from empirical execution evidence.

## Business invariant review

Review both allowed and denied behavior.

## Authorization and organization boundary

Review membership boundaries and client-claim bypass.

## Migration review

## RLS and privileged-function review

Confirm target caller roles are exercised, not only service-role or migration-owner privileges. For privileged functions, inspect owner, fixed `search_path`, input surface, and execute grants.

## Audit and actor identity

## Test effectiveness

Include denial tests and mutation analysis or equivalent discrimination checks for critical security tests where practical.

## Concurrency review

## CI and dependency audit

## Repository state

## Release recommendation

P0/P1 and practical P2 findings block release.
