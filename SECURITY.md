# Security

This document describes the threat model, the controls we implement, and the
boundary between provider/Cloudflare/application responsibilities.

---

## 1. Overview

The application is a single-user personal mail client. Its most sensitive assets
are:

1. **Your email account credentials** (IMAP/SMTP username/password)
2. **Your mail content** and its previews

The system's security is layered: Cloudflare protects the edge (including who
can reach the app, via Cloudflare Access), providers protect their own
endpoints, and the app protects its own data.

### Responsibility boundary

| Control | Owner |
| --- | --- |
| Transport security (TLS) browser<->Cloudflare, Worker<->provider | Cloudflare + provider |
| Authentication to mail provider (OAuth/password) | Provider |
| Authentication to *this app* | Cloudflare Access (worker-level, account members only) |
| CSRF for *this app* | Cloudflare Access (`CF_AppSession` cookie + `SameSite` setting) |
| Password storage | App (AES-GCM, key in Cloudflare secret) |
| HTML email sanitization | App (DOMPurify in browser) |
| Abuse/DoS of endpoints | Cloudflare (rate limiting optional) + app (input limits) |

---

## 2. Threat model & what we protect against

| Threat | Control |
| --- | --- |
| DB dump / backup leak exposes passwords | Passwords encrypted with AES-256-GCM; key never in DB; separate credentials table |
| API CSRF (attacker triggers actions through your browser) | Cloudflare Access edge CSRF (`CF_AppSession` cookie) + `SameSite=Lax` on `CF_Authorization` |
| Access rule disabled in dashboard | Worker fail-safe refuses API requests that carry no Access evidence (403, code `access_required`), so the API can't be silently opened |
| Replay of OAuth authorization codes (Gmail/Outlook connect) | `state` bound to a 10-min httpOnly cookie, verified constant-time |
| XSS via email HTML | DOMPurify sanitization on every render; no raw `v-html` without it; previews only in list |
| Malicious links in mail | Standard `mailto:`/`http(s):` handling; no auto-open; sanitized HTML |
| IDOR (accessing another user's data) | Single-user app — Access admits only account members; no user dimension in the data |
| Leaking credentials in logs | Credentials never logged; error messages are generic; structured logging avoids bodies |
| Unbounded memory/body (malicious mail) | PostalMime nesting/header limits; request size schema caps; fetch limits |

### What we do NOT protect against (documented)

- **Worker runtime compromise**: if Cloudflare's worker process is fully
  compromised, the attacker holds the encryption key and secrets regardless.
  Server-side encryption protects against *offline* DB theft, not runtime pwn.
- **Provider-side compromise**: if your mail provider is compromised, all bets are
  off (the provider already holds your mail and can reset your account).
- **Client machine compromise**: local malware can use the authenticated browser
  session (Cloudflare Access) or view the UI. We cannot prevent that.

---

## 3. Application access (Cloudflare Access)

- The Worker is protected by worker-level Cloudflare Access (policy: account
  members only). Access authenticates at the edge before the Worker runs;
  requests that fail Access never reach the Worker.
- The Worker performs no authentication of its own — no sessions, no app cookies,
  no per-user identity. (Behind Workers Static Assets, `ctx.access` is not
  forwarded to the user Worker, so there is no Access identity to read.) As a
  fail-safe it refuses API requests that carry no Access evidence (a 403,
  code `access_required`), accepting requests only when the runtime `access`
  object is present or the `Cf-Access-Jwt-Assertion` header is set.
- The app has no per-user model: Cloudflare Access decides who can reach it.

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
| `CREDENTIAL_ENCRYPTION_KEY` | Cloudflare secret |
| `APP_URL`, `SYNC_FETCH_LIMIT` | Wrangler vars (non-secret config) |

`.env.example` contains placeholders only. `.env` is never committed (gitignore).
No secrets in client bundles: the SPA has no access to any of the above; it can
only call our API.

## 7. CSRF design

Cloudflare Access protects the app against cross-site request forgery at the
edge — there is no application-level CSRF token. Two mechanisms (per Cloudflare
docs):

- **`CF_AppSession` cookie**: a CSRF token Access issues per application domain
  (HttpOnly, required) and validates at Cloudflare's network.
- **SameSite attribute on `CF_Authorization`**: set to **Lax** (recommended) so
  the auth cookie is not sent on cross-site subresource requests. The docs
  default is `None`; `Strict` can cause `ERR_TOO_MANY_REDIRECTS` and is not
  recommended.

Configure both under **Zero Trust → Access controls → Applications → Configure
→ Advanced settings → Cookie settings** (see DEPLOYMENT.md).

## 8. Provider/Cloudflare security boundary

- Your provider is the authority on your mail: it enforces its own auth, rate
  limits, and abuse detection. We don't add a parallel "security system" on top;
  we correctly authenticate and fail loudly when the provider revokes access.
- Cloudflare terminates TLS, protects against DDoS at the edge, and hosts our
  secrets as encrypted bindings. We rely on that.
- Gmail/Outlook OAuth access + refresh tokens are stored encrypted in D1 and
  never exposed to the client. Cloudflare Access (not the app) owns the browser
  session that gates the app.

## 9. Error handling & logging

- User-facing errors: safe, actionable, never leak credentials/tokens/bodies.
- Server logs: method + path + error class; no request bodies, no cookies, no
  credential strings.
- `HttpError` carries a status + public message; unknown errors become a generic
  500 with the real error logged server-side only.

## 10. Security checklist status (v1)

- [x] Cloudflare Access (worker-level, account members only) — enforced at the edge
- [x] CSRF: Cloudflare Access `CF_AppSession` cookie + `SameSite=Lax` on `CF_Authorization`
- [x] AES-GCM credential encryption (Web Crypto), key in secret
- [x] DOMPurify HTML sanitization on all render paths
- [x] Ownership-scoped queries (no IDOR)
- [x] Input validation via Zod on all API bodies
- [x] No secrets in client bundle; `.env.example` placeholders only
- [ ] Browser Push (phase 8) — subscription storage table exists
- [ ] Remote-image blocking setting (privacy enhancement) — not yet
- [x] OAuth state validation + code exchange server-side (Gmail/Outlook connect)