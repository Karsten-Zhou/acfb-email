# Security

This document describes the threat model, the controls we implement, and the
boundary between provider/Cloudflare/application responsibilities.

---

## 1. Overview

The application is a single-user personal mail client. Its most sensitive assets
are:

1. **Your email account credentials** (IMAP/SMTP username/password)
2. **Your mail content** and its previews
3. **Your session** (ability to act as you in this app)
4. **Your GitHub identity**

The system's security is layered: Cloudflare protects the edge, providers protect
their own endpoints, and the app protects its own data and sessions.

### Responsibility boundary

| Control | Owner |
| --- | --- |
| Transport security (TLS) browser<->Cloudflare, Worker<->provider | Cloudflare + provider |
| Authentication to mail provider (OAuth/password) | Provider |
| Authentication to *this app* (GitHub) | GitHub + app |
| Session integrity for *this app* | App (cookies + hashed DB sessions) |
| Password storage | App (AES-GCM, key in Cloudflare secret) |
| HTML email sanitization | App (DOMPurify in browser) |
| Abuse/DoS of endpoints | Cloudflare (rate limiting optional) + app (input limits) |

---

## 2. Threat model & what we protect against

| Threat | Control |
| --- | --- |
| DB dump / backup leak exposes passwords | Passwords encrypted with AES-256-GCM; key never in DB; separate credentials table |
| DB dump exposes usable sessions | Only SHA-256 hashes stored; raw token only in your cookie |
| Attacker steals session cookie (XSS) | `HttpOnly` + `Secure` + `SameSite=Lax`; sessions expire; server-side revoke |
| Login CSRF (attacker logs you into my account) | OAuth `state` bound to a 10-min httpOnly cookie, verified constant-time |
| API CSRF (attacker triggers actions through your browser) | `x-csrf-token` header must match `ec_csrf` cookie (constant-time); all mutations enforce |
| XSS via email HTML | DOMPurify sanitization on every render; no raw `v-html` without it; previews only in list |
| Malicious links in mail | Standard `mailto:`/`http(s):` handling; no auto-open; sanitized HTML |
| IDOR (accessing another user's data) | Every query scoped by `user_id` join; account/mailbox/message ownership verified |
| GitHub account mismatch | Numeric GitHub ID allowlist; everyone else denied at callback |
| Replay of OAuth authorization codes | `state` one-time use (cookie cleared at callback) |
| Leaking credentials in logs | Credentials never logged; error messages are generic; structured logging avoids bodies |
| Unbounded memory/body (malicious mail) | PostalMime nesting/header limits; request size schema caps; fetch limits |

### What we do NOT protect against (documented)

- **Worker runtime compromise**: if Cloudflare's worker process is fully
  compromised, the attacker holds the encryption key and secrets regardless.
  Server-side encryption protects against *offline* DB theft, not runtime pwn.
- **Provider-side compromise**: if your mail provider is compromised, all bets are
  off (the provider already holds your mail and can reset your account).
- **Client machine compromise**: local malware can read the session cookie or view
  the UI. We minimize exposure (short sessions) but cannot prevent it.

---

## 3. Application login & sessions

- GitHub OAuth web flow, scope `read:user`.
- **Allowlist**: `ALLOWED_GITHUB_USER_ID` (a Cloudflare secret) must equal the
  numeric GitHub user id. A username change does not grant access.
- Session cookie `ec_session`: `HttpOnly`, `Secure` (production), `SameSite=Lax`,
  default 7 days (configurable), server-side row with SHA-256 hash + expiry, and
  a `revoked` flag for logout.
- Session lookup is a DB query per request; no client-visible token stored in
  localStorage/IndexedDB.

## 4. Email credentials

- **AES-256-GCM** via Web Crypto (Workers runtime), key = `CREDENTIAL_ENCRYPTION_KEY`
  (Cloudflare secret, 32 bytes hex). IV is random 12 bytes per encryption.
- Storage format `v1:<base64(iv)>.<base64(ciphertext+tag)>` — authenticated
  encryption means tampering is detected.
- Never returned by any API. Only read server-side at sync/send time, then
  forgotten.
- Plaintext is only ever in a Worker request's local memory.

## 5. Email content handling

- **Untrusted input**: email HTML is treated as hostile.
- Sanitization: `DOMPurify` (browser) on every render path; blocked tags/attrs
  (scripts, event handlers, `javascript:` URLs, `iframe`, etc.).
- The list API returns only small previews; the detail API returns parsed
  text/html previews from PostalMime (which bounds nesting/headers).
- Attachments are metadata-only in v1 (no inline execution possible).
- External images are rendered by the browser normally (a tracking risk by
  design; a privacy-conscious user can disable remote images — not yet a setting).

## 6. Secrets management

| Secret | Where |
| --- | --- |
| `GITHUB_CLIENT_ID/SECRET` | Cloudflare secrets (prod); `.env` (local, git-ignored) |
| `ALLOWED_GITHUB_USER_ID` | Cloudflare secret |
| `CREDENTIAL_ENCRYPTION_KEY` | Cloudflare secret |
| `APP_URL`, `SESSION_DAYS`, `SYNC_FETCH_LIMIT` | Wrangler vars (non-secret config) |

`.env.example` contains placeholders only. `.env` is never committed (gitignore).
No secrets in client bundles: the SPA has no access to any of the above; it can
only call our API.

## 7. CSRF design

Browsers send cookies on cross-site requests automatically, so any dangerous
mutation must require a value the attacker's page cannot read. We use the
**double-submit cookie** pattern:

1. On login, server sets `ec_csrf` (httpOnly **false** so JS can read it, SameSite=Strict).
2. All non-GET API requests must include `x-csrf-token: <cookie value>`.
3. Server compares header vs cookie with a constant-time XOR compare.
4. `csrfGuard` runs on `/api/*` before route handlers (auth runs first, so
   unauthenticated requests get 401 before CSRF — intentional).

Because `ec_csrf` is SameSite=Strict, cross-site requests don't even carry it;
the header check is the defense-in-depth.

## 8. Provider/Cloudflare security boundary

- Your provider is the authority on your mail: it enforces its own auth, rate
  limits, and abuse detection. We don't add a parallel "security system" on top;
  we correctly authenticate and fail loudly when the provider revokes access.
- Cloudflare terminates TLS, protects against DDoS at the edge, and hosts our
  secrets as encrypted bindings. We rely on that.
- OAuth providers (GitHub now; Google/Microsoft later) hold the tokens — we only
  ever hold short-lived application sessions derived from the login, never the
  provider's long-lived tokens client-side.

## 9. Error handling & logging

- User-facing errors: safe, actionable, never leak credentials/tokens/bodies.
- Server logs: method + path + error class; no request bodies, no cookies, no
  credential strings.
- `HttpError` carries a status + public message; unknown errors become a generic
  500 with the real error logged server-side only.

## 10. Security checklist status (v1)

- [x] GitHub OAuth + numeric allowlist
- [x] HttpOnly/Secure/SameSite session cookie, hashed in DB, server-side revocation
- [x] CSRF double-submit on all mutations
- [x] AES-GCM credential encryption (Web Crypto), key in secret
- [x] DOMPurify HTML sanitization on all render paths
- [x] Ownership-scoped queries (no IDOR)
- [x] Input validation via Zod on all API bodies
- [x] No secrets in client bundle; `.env.example` placeholders only
- [ ] Browser Push (phase 8) — subscription storage table exists
- [ ] Remote-image blocking setting (privacy enhancement) — not yet
- [x] OAuth state validation + code exchange server-side