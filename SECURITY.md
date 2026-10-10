# Security policy

ProofWorks records governance evidence, so its integrity guarantees (tenant
isolation, append-only receipts, the hash-chained event ledger) are treated as
security properties. Reports that break any of them are in scope.

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.

## Reporting a vulnerability

Please report privately, not in a public issue:

- **GitHub:** use **Security → Report a vulnerability** on this repository, or
- **Email:** [hello@howldr.com](mailto:hello@howldr.com) with "SECURITY" in the subject.

Include what you found, how to reproduce it, and the impact you expect. We'll
acknowledge reports as soon as we can and keep you updated until the issue is
resolved. Please give us a reasonable chance to fix the issue before disclosing
it publicly. We're glad to credit you in the fix unless you'd rather stay
anonymous.

## In scope

- Cross-tenant access — reading or changing another workspace's data
- Bypassing a role or module gate in the API (`requireSameTenant`,
  `requireModule`, role checks)
- Altering or forging a receipt, approval, or ledger entry, or making the
  hash-chain verification pass when it shouldn't
- Authentication or JWT verification flaws
- Secrets or credentials exposed by the application

## Out of scope

- Vulnerabilities in LiquidFiles, Supabase, Railway, or Cloudflare themselves —
  report those to the vendor
- Findings that need an already-compromised admin account or server
- Missing hardening headers or best-practice notes with no demonstrated impact
