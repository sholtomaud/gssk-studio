# ADR 0005 — No network in v1

**Status**: accepted (M0)

## Context

gssk-dia stores a Gemini API key in `localStorage`, calls Gemini to write articles, and polls
third-party data APIs. Each is egress the user cannot audit, and a key in plain storage is
readable by any script on the origin.

## Decision

v1 makes no request outside its own origin. The production CSP is `connect-src 'self'`, and
`tests/e2e/privacy.spec.ts` fails on any foreign request. AI write-ups, live data and PDF reports
are milestone M6 and must be opt-in, consented per call, listed in the CSP at build time, with keys
held in memory or encrypted at rest. An LLM may describe a run; it never produces a number
(NFR-HON-002).

## Consequences

- The app works offline and is safe for unpublished models.
- Features gssk-dia had (Gemini articles, the article library, data connectors) are not in M1.
