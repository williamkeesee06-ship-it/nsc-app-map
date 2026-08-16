# ADR 0001: Earth Feed Authentication — HMAC Signed URLs vs Firebase ID Tokens

**Status:** Accepted
**Date:** 2026-08-15
**Deciders:** William Keesee
**Context:** NSMS Phase 0–3 rebuild (PR #17)

## Context

The Earth Bridge exposes two public-by-URL endpoints that Google Earth's
Network Link feature fetches on a schedule:

- `GET /api/earth/network-link/:jobId.kml`
- `GET /api/earth/layers/:jobId/:layer.kml`

Google Earth Desktop fetches these URLs on a polling interval it controls.
It **cannot send an `Authorization` header** and it **cannot participate in
OAuth or Firebase Auth flows**. The token that authorizes the fetch must
live in the URL itself (query parameter).

Two candidate designs were considered:

### Option A — Firebase ID token in `?token=` query

Front-end reads `getIdToken()` and appends it to the KML URL before pasting
into Earth.

### Option B — HMAC-signed feed token (shipped)

Backend mints an opaque token `{jobId, exp, sig}` signed with
`EARTH_FEED_TOKEN_SECRET` (HS256, constant-time compare). Frontend calls
`POST /api/jobs/:jobId/earth/network-link` (Firebase-authed) to receive the
URL with the signed token baked in.

## Decision

**We ship Option B (HMAC-signed feed tokens).**

## Rationale

### 1. Firebase ID tokens have a 1-hour lifetime

Network Links poll for **days**. A Firebase ID token would break after 60
minutes and there is no way for Google Earth to refresh it — the user would
have to re-paste a new URL every hour. The Network Link feature becomes
unusable.

HMAC feed tokens are TTL-bound to whatever the operator chooses (default 30
days, max 365).

### 2. URLs leak. Firebase ID tokens contain identity claims.

A URL that Google Earth fetches ends up in:

- Google Earth's desktop cache and log files (unencrypted)
- Any HTTP proxy or corporate SSL-inspection appliance between the user and
  the API
- CDN access logs
- API server access logs (`/var/log/nginx/access.log` style)
- Any error report or Sentry breadcrumb that captures the URL

A Firebase ID token in that URL leaks the user's UID, email, custom claims,
and — if intercepted before expiry — full impersonation capability against
every Firebase service. That is a much larger blast radius than a leaked
HMAC token, which authorizes exactly one job's KML feed for the remaining
TTL and nothing else.

### 3. Instant revocation vs 1-hour wait

If the operator suspects a token is compromised:

- **HMAC (shipped):** rotate `EARTH_FEED_TOKEN_SECRET`. Every outstanding
  feed URL is dead immediately.
- **Firebase ID token:** you cannot revoke a specific token; you would have
  to `revokeRefreshTokens(uid)`, which nukes the user's session across
  every device and every Firebase surface, and outstanding ID tokens still
  work until they expire (up to 60 min).

### 4. Least-privilege scope

An HMAC feed token authorizes exactly one operation on one job:
`GET /api/earth/{network-link,layers}/:jobId.*`. It cannot approve
revisions, cannot read audit logs, cannot mutate any Firestore doc. A
Firebase ID token in the URL is a bearer credential for the entire API.

### 5. No PII in URLs

The HMAC token is opaque bytes. It contains no email, UID, or any
user-identifying field. This is a strictly better posture for a URL that
gets pasted into third-party desktop software.

## Trade-offs

**Cost of Option B:**

- Requires operator to set `EARTH_FEED_TOKEN_SECRET` (min 32 chars). The
  API fails loud at call time if unset — see `apps/api/src/config/env.ts`.
- Rotation requires all in-flight Network Link URLs to be re-minted.

Both are acceptable — the first is standard secret management, the second
is the entire point of the rotation feature.

## Implementation

- `apps/api/src/services/kmlService.ts` — `signFeedToken()` /
  `verifyFeedToken()` using `crypto.createHmac("sha256", ...)` with
  `crypto.timingSafeEqual` for constant-time comparison. Token format:
  `base64url(jobId.exp).base64url(sig)`.
- `apps/api/src/middleware/requireAuth.ts` — Earth feed paths are declared
  public; HMAC is verified inside the route handler, not by the global
  auth middleware.
- `apps/api/src/routes/jobs.ts` — `POST /jobs/:jobId/earth/network-link`
  mints URLs; TTL clamped to `[1, 365]` days, default 30.
- Frontend: `EarthDesignPanel` calls the mint endpoint (Firebase-authed)
  and displays the resulting URL for the user to paste into Google Earth.

## Revisit if

- Google Earth adds header support to Network Link fetches (unlikely).
- Firebase adds long-lived, scoped, revocable app tokens (the "custom
  claims stapled to a service credential" pattern) — we would move to
  those.
