# Product And Scope

## Goal

Rebuild the SKRHAL bunker bidding system on a Supabase-backed stack while preserving the existing Firebase prototype only as a reference artifact.

## Foundation PR scope

- create the new application shell
- preserve the legacy prototype
- prepare local tooling, CI, and documentation

## Excluded from this phase

- auth flows
- invitation flows
- organization, deal, or quote tables
- `.msg` or `.eml` migration
- approval and submission business rules
- schema migrations and RLS policies
