# ADR 0002 — Vendor the same pinned GSSK build as budget-app

**Status**: accepted (M0)

## Context

gssk-dia depends on `github:sholtomaud/GSSK#dist`, resolved at install time: the kernel a visitor
runs is whatever the branch held when CI last built. budget-app vendors
`energese-project/GSSK-Giannantoni@dist` 5.3.0 at a fixed commit with SHA-256s in
`GSSK_PIN.json`, and its worker refuses a kernel whose hash does not match.

## Decision

Vendor the identical pin (`3043a57c…`, 5.3.0) in `vendor/gssk/`, verify it in CI
(`npm run gssk:verify`) and before instantiation in the worker, and upgrade only through
`npm run gssk:update -- <dist-commit>` in its own PR.

## Consequences

- Results are reproducible from a run's manifest: kernel version and hash are recorded.
- Both apps move to a new kernel deliberately and can share kernel tests and kernel requests.
- 5.3.0 supports every Odum symbol natively (ADR 0003), which gssk-dia's kernel use did not exploit.
