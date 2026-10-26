# ADR 0012 — Publishing services through a stateless token proxy

**Status**: proposed (M10). Amends ADR 0005 and the SPEC §1.2 non-goal "a server".

## Context

Publishing a model and its paper needs GitHub (to keep `.tex`, `.ts`, `.gssk.json` and run
manifests in a repository) and Zenodo (to mint a DOI, which Zenodo already does from GitHub
releases). GitHub's OAuth token endpoint does not allow cross-origin requests from a browser, and
an OAuth app's client secret cannot live in a static page. A static app can only ask users to
paste a personal access token, which is poor practice to teach.

## Decision

- One **stateless token-exchange function on AWS Lambda** (a function URL): it takes GitHub's
  OAuth `code`, adds the client secret, returns the access token, and stores nothing. CORS allows
  only the studio's origins.
- The studio keeps the token **in memory** for the session (ADR 0005: never in plain
  `localStorage`). All GitHub and Zenodo API calls go from the browser straight to those APIs.
- Each service is opt-in, consented per action, and its origins are added to the build's
  `connect-src` in review: the proxy's URL, `api.github.com`, `zenodo.org`.
- The privacy e2e test changes from "no foreign request" to "no foreign request until the user
  connects a service, and then only to the listed origins".

## Consequences

- Real OAuth with no stored user data, and a function small enough to audit.
- One deployed component to run and secure (the secret, the allowed origins, rate limits).
- arXiv has no general open submission API; the studio exports a submission bundle instead.
