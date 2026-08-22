# Build a Personal Cloudflare-Based Web Email Client

You are the coding agent responsible for designing, implementing, testing, and documenting a production-quality personal web email client.

The user is the **only intended user** of this application. Treat the user as technically capable of making decisions but **not knowledgeable about implementation details**.

Your job is not merely to follow instructions literally. You are expected to act as a careful senior engineer who protects the project from bad architectural decisions.

---

## 1. Core Working Rules

### 1.1 Assume I am an idiot about implementation details

Do not assume that I understand:

* Cloudflare Workers internals
* browser security
* OAuth
* cookies and sessions
* IMAP/SMTP/POP3
* email MIME structure
* asynchronous processing
* database design
* cryptography
* browser notification APIs
* caching
* networking
* Vite configuration
* TypeScript architecture
* Vue reactivity
* deployment and secrets management

When something is important, explain it in plain language before asking me to make a decision.

Do not hide an important architectural decision behind an implementation detail.

### 1.2 Challenge me when my request conflicts with best practices

If my instructions differ significantly from industrial best practices:

1. Clearly explain what the standard best practice is.
2. Explain why my requested approach is inferior, risky, unnecessarily complex, or difficult to maintain.
3. Explain the consequences in practical terms.
4. Tell me what you recommend instead.
5. Ask me to confirm the intent **only when the difference is materially important**.

Do not blindly implement an obviously bad design just because I asked for it.

However, do not become argumentative about harmless stylistic preferences.

### 1.3 Strongly prefer established third-party libraries

Prefer mature, well-maintained, widely used libraries over handwritten infrastructure.

Before writing a custom implementation, search for an appropriate existing library.

For third-party libraries:

1. Read the **official documentation first**.
2. Check the official repository/package documentation if necessary.
3. Check compatibility with:

   * Bun
   * Vite
   * Vue
   * Cloudflare Workers
   * Cloudflare Vite plugin
   * the Workers runtime APIs
4. Prefer stable APIs over experimental APIs when practical.
5. Prefer small, composable dependencies over giant frameworks when they solve the actual problem.
6. Only inspect a library's source code as a **last resort**, after documentation and normal usage examples are insufficient.

Never invent an API because you remember a library "probably" works that way.

### 1.4 Verify current documentation

This project uses technologies that evolve quickly.

For Cloudflare, Vue, Vite, Hono, Shadcn/Reka UI, browser APIs, authentication providers, email libraries, and other significant dependencies:

* consult the current official documentation before implementation;
* do not rely on old blog posts when official documentation exists;
* if an API or platform capability is uncertain, verify it before designing around it.

When documentation contradicts your memory, trust the current official documentation.

---

# 2. Product Goal

Build a personal, polished web email client hosted primarily on Cloudflare.

The client should allow me to connect multiple email accounts and use them through one unified interface.

The application should feel like a modern commercial email application rather than an internal CRUD dashboard.

It must work well on:

* desktop
* tablet
* mobile phones

The UI must be responsive rather than simply shrinking the desktop layout.

---

# 3. Preferred Technology Stack

Use this stack unless there is a strong technical reason not to:

### Runtime / build

* Bun
* Vite
* TypeScript
* `@cloudflare/vite-plugin`

### Frontend

* Vue 3
* TypeScript
* Composition API
* Vue Router where appropriate
* Shadcn/Reka UI as the primary UI component library
* Tailwind CSS as a **supporting utility layer**, not the primary component system

Do not build dozens of custom Tailwind components when a mature Shadcn/Reka UI component already solves the problem.

Use Shadcn/Reka UI's accessibility and interaction behavior wherever practical.

### Backend

* Hono
* Cloudflare Workers

Prefer a clean separation between:

* HTTP/API routing
* authentication
* email provider adapters
* synchronization jobs
* persistence
* business logic

Do not put the whole backend into one giant Hono route file.

---

# 4. Cloudflare Architecture

Design the application to fit the **Cloudflare Workers Free tier first**.

Do not casually assume an always-on traditional Node.js server.

Relevant Cloudflare constraints must be treated as architectural constraints rather than implementation trivia.

The current Free plan includes limits such as:

* 100,000 Worker requests/day
* 50 subrequests per invocation
* 6 simultaneous outgoing connections/request
* 128 MB memory
* 100 MB request body size
* Free D1 database size of 500 MB
* Workers KV Free-tier usage limits
* Workers Queues being available on Free, with limited daily operations and 24-hour message retention

Verify the current official limits during implementation rather than hard-coding assumptions from this prompt.

Use Cloudflare services only where they make architectural sense.

Potential components include:

* Workers
* D1
* KV
* R2
* Queues
* Cron Triggers
* Workers Secrets
* WebSockets or Server-Sent Events where appropriate
* Browser Push API for notifications

Do not automatically use every Cloudflare product.

For every persistent-data technology, explain why it is being used.

---

# 5. Important Email-Networking Requirement

Cloudflare Workers now provide outbound TCP socket support, which can enable protocols such as SMTP and other TCP-based protocols.

However, **do not assume that a Node.js email library will work in Workers simply because it works in Bun or Node.js.**

For every email protocol library, verify:

* Workers compatibility
* TCP/TLS behavior
* Web Streams compatibility
* dependency compatibility
* bundle size
* authentication support
* connection lifecycle behavior
* timeout behavior
* concurrent connection behavior
* whether it expects Node's `net`/`tls` APIs

If a traditional Node library is incompatible with Workers, do not force a Node compatibility workaround unless it is actually a sound architecture.

---

# 6. Email Provider Architecture

Create a provider abstraction so the UI and business logic do not care whether an account is Gmail, Microsoft, or a generic mail server.

For example, conceptually:

```text
EmailAccount
    |
    +-- Gmail adapter
    +-- Microsoft adapter
    +-- Generic IMAP/SMTP adapter
    +-- Generic POP3 adapter (if supported)
```

Do not duplicate mailbox logic across providers.

The adapter architecture should make it possible to add another provider later.

---

# 7. Protocol and Provider Support

The application should support common email access methods.

At minimum investigate and support:

### Generic IMAP

Used for:

* listing folders
* fetching messages
* reading message bodies
* flags
* search where supported
* moving/copying messages
* deleting messages
* marking read/unread
* attachments

### SMTP

Used for sending email.

Support:

* STARTTLS where applicable
* implicit TLS where applicable
* authenticated SMTP
* attachments
* HTML + plain-text messages

### POP3

Investigate support for POP3.

Because POP3 has materially weaker mailbox semantics than IMAP, do not pretend that POP3 provides the same feature set.

If POP3 support would require disproportionate complexity, clearly explain the trade-off and consider making it read/import-oriented rather than pretending it is a full mailbox provider.

### Provider-specific APIs

For major providers where OAuth and official APIs are preferable, use the provider API instead of unnecessarily using raw username/password authentication.

Examples to investigate:

* Gmail / Google APIs
* Microsoft Graph / Outlook

Do not make a generic password field the default way of connecting Gmail or Outlook accounts when a modern OAuth integration is available.

---

# 8. Gmail and Microsoft Authentication

For Gmail and Outlook/Microsoft accounts, prefer the provider's modern OAuth-based authentication flow.

Do not ask users to type a normal account password into the application when OAuth is available.

The agent must research the current official provider documentation and determine:

* OAuth scopes
* authorization flow
* refresh-token behavior
* token expiration
* token storage
* revocation
* reconnect behavior
* permission minimization

Never store provider OAuth access tokens in browser local storage.

Never expose provider client secrets to the frontend.

---

# 9. Generic Email Account Credentials

For generic IMAP/SMTP/POP3 accounts, credentials may have to be provided by the user.

Treat those credentials as highly sensitive.

Do not store plaintext passwords in D1.

Use authenticated encryption such as AES-GCM or another well-established cryptographic construction, with a key held in Cloudflare secrets rather than in source code or the database.

Separate:

* encryption key
* encrypted credential
* account metadata

Do not invent a cryptographic protocol.

Use Web Crypto APIs or a mature, well-reviewed cryptographic library that is compatible with Workers.

Document the threat model and explain what protection is and is not provided.

---

# 10. Authentication of the Web Application

There is only one intended human user.

Use GitHub to verify identity.

Login should work approximately like:

```text
Browser
  -> GitHub authorization
  -> OAuth callback
  -> verify GitHub identity
  -> create application session
  -> browser receives secure session cookie
```

Use the current official GitHub OAuth documentation rather than implementing an old flow from memory. GitHub documents the web authorization-code flow for browser-based applications.

The application should have an explicit allowlist for the authorized GitHub identity.

Do not assume:

> "Anyone who can sign in with GitHub is allowed to use the email client."

Instead:

* verify the GitHub account identity;
* compare the authenticated GitHub user ID against the configured allowed user;
* deny everyone else.

Prefer a stable GitHub numeric user ID over using only a mutable username.

Store the application session in secure cookies.

Use:

* `HttpOnly`
* `Secure` in production
* appropriate `SameSite`
* short-lived sessions where practical
* server-side session invalidation if required

Never put the long-lived application session token in ordinary browser local storage.

---

# 11. Authorization Model

This is a single-user application.

Do **not** create an elaborate multi-tenant organization system unless the architecture requires some portion of it for security.

However, architect the code so that a future multi-user version would not require rewriting every email operation.

Every persistent entity should still have a clear ownership boundary.

---

# 12. Security Baseline

Implement sensible web application security, including at minimum:

* CSRF protection where applicable
* secure cookies
* strict input validation
* output encoding
* XSS defenses
* HTML email sanitization
* safe URL handling
* safe attachment handling
* request size limits
* rate limiting where useful
* OAuth state validation
* session expiration
* authorization checks
* protection against IDOR-style access
* protection against unsafe redirects
* server-side validation even when the client validates
* careful error handling
* secrets never committed to git
* no credentials in logs
* no access tokens in logs
* no email passwords in logs

Email HTML is **untrusted input**.

Never directly inject raw email HTML into the application page.

Sanitize HTML email using a mature sanitizer compatible with the environment.

Treat:

* HTML
* CSS
* images
* remote URLs
* links
* attachments
* embedded content

as potentially hostile.

---

# 13. "Do Not Reimplement Email Security"

If Gmail, Microsoft, or another provider already handles some security behavior at the provider level, do not duplicate it unnecessarily.

For example, do not invent an additional "security system" merely to say the application has one.

Instead, determine which security controls belong to:

* the provider
* the OAuth provider
* Cloudflare
* the application

Then implement only what the application actually needs.

Explain the boundary between those systems.

---

# 14. Core Email Operations

Support the common operations users expect from a modern email client.

At minimum:

### Reading

* mailbox list
* message list
* message detail
* unread state
* sender
* recipients
* date/time
* subject
* snippets
* labels/folders
* attachments
* HTML/plain text body
* quoted text handling where practical

### Message state

* mark read
* mark unread
* star / important where provider supports it
* archive
* trash
* restore
* spam/junk where provider supports it
* move to folder
* copy to folder
* labels where provider supports them

### Sending

* compose
* reply
* reply all
* forward
* recipient autocomplete
* CC
* BCC
* subject
* plain text
* HTML
* attachments
* draft saving
* discard draft
* send

### Bulk operations

Support selection of multiple messages and operations such as:

* mark read/unread
* archive
* delete
* move
* spam
* star/unstar where supported

Do not perform huge bulk operations serially in a way that will exceed Cloudflare limits.

Use batching, queues, provider batch APIs, or controlled concurrency where appropriate.

---

# 15. Search

Support searching messages.

The architecture should allow:

* provider-side search where possible
* local search where appropriate
* account-specific search
* unified mailbox search

Do not download an entire mailbox to D1 merely so a simplistic local search implementation is possible.

Be conscious of:

* privacy
* storage
* synchronization cost
* API limits
* Cloudflare free-tier limits
* indexing complexity

Explain the chosen search architecture.

---

# 16. Unified / Union Inbox

This is an important feature.

The UI should provide:

```text
All Mail
├── Gmail
├── Outlook
├── Personal IMAP
└── Other accounts
```

and also a unified inbox such as:

```text
Unified Inbox
--------------------------------
Account A   sender   subject
Account B   sender   subject
Account C   sender   subject
...
```

The unified inbox must preserve the originating account.

Every message in the internal model should be able to identify:

* account
* provider
* remote mailbox/folder
* remote message ID
* thread/conversation information if available

Do not assume message IDs are globally unique across providers.

Use an internal stable identifier.

---

# 17. Synchronization Architecture

This is one of the most important architectural areas.

Do not build the application around:

```text
every page load -> connect to every email account -> download everything
```

That will be slow, fragile, and likely incompatible with the free-tier limits.

Instead, design explicit synchronization.

Potential architecture:

```text
Cron / user action
       |
       v
create sync job
       |
       v
Cloudflare Queue
       |
       v
sync worker
       |
       +--> provider adapter
       |
       +--> update D1
       |
       +--> optionally cache in R2/KV
```

Investigate whether Queues are appropriate for:

* initial mailbox synchronization
* incremental sync
* outgoing mail retries
* notification events
* attachment processing

Cloudflare Queues are available on the Free plan, but the Free plan has daily operation and retention constraints, so do not design an unbounded job system around them.

Use incremental synchronization wherever possible.

Prefer provider-native incremental mechanisms such as:

* IMAP UID / UIDVALIDITY
* provider history APIs
* delta APIs
* sync cursors
* change tokens

rather than repeatedly downloading the same messages.

---

# 18. Real-Time vs Periodic Synchronization

Do not promise true instant mail delivery unless the architecture can actually provide it.

Distinguish between:

* manual refresh
* periodic background sync
* near-real-time provider notifications
* browser push notifications

Where provider APIs support push/webhooks, investigate them.

Where they do not, use reasonable periodic synchronization.

For the first version, prioritize correctness and reliability over pretending synchronization is real-time.

---

# 19. Browser Notifications

Support browser notifications using the browser's notification system.

Use:

* Notification API
* Push API / Service Worker where appropriate

Ask for notification permission at an appropriate moment rather than immediately on first page load.

Notifications should support things such as:

* new email
* optionally important mail

Avoid notifying repeatedly for the same message.

Store browser push subscription data securely.

Allow the user to enable/disable notifications.

Support different notification preferences per account if practical.

Clearly handle browsers/devices that do not support the required notification capability.

---

# 20. Local Caching

Use client-side caching where it materially improves UX.

Possible technologies:

* IndexedDB
* a mature caching/data library
* service worker caching

Do not blindly cache sensitive email content forever.

Define what should be cached, for how long, and why.

A reasonable design may cache:

* recent message metadata
* recent message bodies
* UI state

while being more conservative with:

* attachments
* large HTML bodies
* credentials
* tokens

Never cache authentication secrets in ordinary client-side storage.

---

# 21. Attachments

Support common email attachments.

Be careful about:

* large files
* memory consumption
* MIME decoding
* content types
* filenames
* unsafe file types
* browser previews

Do not automatically execute or inline dangerous attachment types.

Do not load huge attachments entirely into Worker memory when a streaming strategy is possible.

Investigate whether R2 is appropriate for temporary attachment storage or caching.

Do not store every attachment forever unless there is a clear product requirement.

---

# 22. Email Rendering

Email rendering is a hostile-content problem.

Use established libraries for:

* MIME parsing
* quoted-printable decoding
* base64 decoding
* MIME multipart parsing
* message parsing
* attachment extraction
* email address parsing

Do not write a complete MIME parser yourself.

Prefer established libraries such as an appropriate MIME/email parser after verifying Workers compatibility.

The agent should research the best currently maintained libraries rather than blindly selecting a package by name from this prompt.

---

# 23. Email Composition

The compose editor should be polished but not overengineered.

Support:

* plain text mode
* HTML mode or a well-designed rich-text editor
* attachments
* inline images if practical
* draft persistence
* reply quoting
* signatures if practical

Use a mature editor component rather than creating a rich text editor from scratch.

Protect against malformed or unsafe generated HTML.

---

# 24. Thread / Conversation View

Where provider information makes threading possible, group messages into conversations.

Do not assume every provider has identical threading semantics.

The data model should support:

* conversation/thread ID
* message ID
* references / in-reply-to
* provider-specific threading metadata

The UI should gracefully degrade to chronological message view when reliable threading information is unavailable.

---

# 25. Responsive UI

Design for desktop and mobile from the beginning.

Desktop may use:

```text
-----------------------------------------------------
| accounts/folders | message list | message detail |
-----------------------------------------------------
```

Mobile may use navigation states such as:

```text
Mailbox
   -> message list
      -> message detail
```

Do not simply hide half the desktop UI on mobile.

Use appropriate mobile interaction patterns:

* touch-friendly controls
* swipe actions where appropriate
* compact toolbar
* responsive compose UI
* bottom navigation or mobile navigation where useful
* readable message typography
* attachment previews appropriate for smaller screens

Test at realistic viewport sizes.

---

# 26. UI / Design Requirements

The UI should feel:

* modern
* calm
* polished
* fast
* trustworthy
* professional
* information-dense without being cluttered

Shadcn/Reka UI should be the main component system.

Tailwind should be used for:

* layout adjustments
* spacing
* responsive utilities
* occasional custom presentation details

Do not build a second component library on top of Shadcn/Reka UI unless there is a real need.

Prefer accessible controls and keyboard navigation.

Support:

* keyboard shortcuts where practical
* focus management
* screen-reader-friendly labels
* appropriate ARIA where needed
* sufficient contrast
* visible focus states

Use dark mode if it can be done cleanly without creating excessive complexity.

---

# 27. Application Architecture

Prefer a modular structure approximately along these lines:

```text
client/
  components/
  views/
  composables/
  stores/
  router/
  styles/
server/
  routes/
  auth/
  email/
  providers/
  sync/
  notifications/
  security/
shared/
  types/
  schemas/
  constants/
package.json // and other top level files
```

The exact folder structure is up to you.

Do not follow this literally if a better architecture exists.

The important requirement is separation of concerns.

---

# 28. Type Safety

Use TypeScript seriously.

Avoid:

* `any`
* unsafe casts
* duplicated model definitions
* unvalidated external data

Use runtime validation where data crosses trust boundaries.

A mature validation library such as Zod or an appropriate alternative should be considered.

Types should distinguish between:

* user input
* trusted application state
* provider responses
* database records
* sanitized email content

---

# 29. Database Design

Use D1 only for information that belongs in relational persistent storage.

Likely entities include:

* users / application identity
* email accounts
* provider configuration
* encrypted credentials/tokens
* mailboxes/folders
* messages
* message recipients
* attachments metadata
* synchronization state
* push subscriptions
* drafts
* application settings

Do not store huge amounts of raw email unnecessarily.

Be especially conscious of D1's Free-tier storage limit.

Design indexes intentionally.

Provide database migrations.

Do not modify production schema manually without a migration.

---

# 30. Secret Management

Never place secrets in:

* source control
* client JavaScript
* public Vite environment variables
* database plaintext fields
* logs
* error reports

Understand the difference between:

* frontend build-time variables
* Worker environment variables
* Cloudflare secrets

Document setup clearly.

Provide an `.env.example` / equivalent configuration template containing placeholders only.

---

# 31. Logging and Error Handling

Errors should be useful to the developer without leaking sensitive information.

Never log:

* passwords
* OAuth access tokens
* refresh tokens
* session cookies
* full raw email content
* private attachment contents

Use structured logs where practical.

User-facing errors should say what happened and what action the user can take.

Do not expose stack traces in production.

---

# 32. Testing

Do not stop after the UI appears to work.

Provide tests for:

### Unit tests

* authentication helpers
* provider adapters
* email parsing
* MIME handling
* synchronization state transitions
* data validation
* authorization rules

### Integration tests

* Hono routes
* authentication flows
* database operations
* provider mocks
* send/reply behavior
* synchronization

### Worker/runtime tests

Use the current recommended Cloudflare testing tooling rather than trying to fake Workers APIs manually.

Hono's current Cloudflare guidance recommends the Cloudflare-specific Vitest pool tooling for Workers testing.

### UI tests

Test the important flows:

* login
* mailbox navigation
* open email
* mark read
* compose
* reply
* attachment
* account connection
* mobile navigation

---

# 33. E2E Testing

Use an established browser automation tool if appropriate, such as Playwright.

At minimum test:

```text
Login
 -> mailbox
 -> open message
 -> reply
 -> send
 -> verify state updates
```

Also test mobile viewport behavior.

---

# 34. Local Development

The project must be pleasant to run locally.

Provide simple commands such as:

```text
bun install
bun dev
bun test
bun lint
bun typecheck
bun build
bun deploy
```

Use Bun unless a specific Cloudflare tool genuinely requires another package manager command.

Do not introduce npm/pnpm/yarn-specific assumptions unnecessarily.

---

# 35. Linting / Formatting / Code Quality

Use established tools for:

* linting
* formatting
* TypeScript checking
* import sorting if appropriate
* test execution

Do not spend time building custom tooling for these jobs.

CI should fail on:

* type errors
* lint errors
* failing tests
* broken production build

---

# 36. Deployment

Deployment should target Cloudflare Workers using the current recommended Vite + Cloudflare integration.

The current Cloudflare/Hono documentation recommends the Cloudflare Vite plugin approach for new full-stack Workers projects.

Use Wrangler where appropriate.

The deployment documentation must explain:

1. Cloudflare account setup
2. GitHub application setup
3. secrets
4. D1 database creation
5. migrations
6. optional KV/R2/Queue resources
7. production environment variables
8. deployment
9. rollback/recovery basics

Do not silently create infrastructure that requires paid services without explaining it.

---

# 37. Free-Tier Discipline

Treat "Cloudflare Free tier" as an explicit product requirement.

If a proposed feature would likely exceed Free-tier limits, explain:

* which limit is involved;
* why it happens;
* whether there is a more efficient design;
* whether the feature should be optional;
* whether it would require a paid plan.

Do not optimize prematurely, but do not build obviously wasteful synchronization loops either.

Include rate/backpressure mechanisms where needed.

---

# 38. Observability

Provide a lightweight way to diagnose:

* provider connection failures
* OAuth failures
* synchronization failures
* send failures
* queue failures
* malformed email failures

The system should make it possible to answer:

> "Why didn't this account synchronize?"

without needing to inspect arbitrary application source code.

---

# 39. Provider Failure Handling

Email providers will fail sometimes.

Handle:

* timeout
* authentication failure
* expired OAuth token
* revoked authorization
* invalid credentials
* temporary provider failure
* rate limiting
* mailbox unavailable
* malformed server response

Use retries only where retrying makes sense.

Do not blindly retry authentication failures forever.

Use exponential backoff for transient errors where appropriate.

The UI should distinguish:

```text
Account healthy
Account temporarily unavailable
Authentication required
Configuration invalid
Synchronization paused
```

---

# 40. Idempotency

Email synchronization and message sending can produce duplicate operations if a worker retries.

Design important operations to be idempotent where practical.

Examples:

* sync jobs
* message insertion
* flag updates
* move/delete operations
* notification delivery
* outgoing send retries

Do not accidentally send the same email twice because a Worker retried after an ambiguous network failure.

---

# 41. Data Model and Provider Semantics

Do not flatten provider-specific concepts into an oversimplified model too early.

For example:

* Gmail labels are not exactly the same thing as IMAP folders.
* Outlook folders and categories are not necessarily the same thing as Gmail labels.
* POP3 does not behave like IMAP.
* threading differs between providers.

The internal model should expose common behavior while preserving provider-specific metadata when necessary.

---

# 42. UX for Account Connection

Provide a clear "Add account" flow.

Possible choices:

```text
Add email account

[ Google / Gmail ]
[ Microsoft / Outlook ]
[ IMAP / SMTP ]
[ POP3 ]
```

Do not put obscure protocol settings in the primary UI unless necessary.

For generic accounts, progressively reveal advanced settings.

Show connection-test results clearly.

---

# 43. Settings

Provide a settings area for:

* connected accounts
* account display name
* signatures
* notifications
* theme
* synchronization behavior
* default sending account
* compact/cozy density
* keyboard shortcuts
* security/session information

Avoid creating 100 settings before the basic product is stable.

---

# 44. Accessibility and UX Quality

Treat accessibility as part of correctness.

At minimum:

* keyboard navigation
* semantic controls
* proper labels
* focus handling
* focus restoration after dialogs/navigation
* reduced-motion awareness where appropriate
* readable text
* usable mobile tap targets

Do not use icon-only buttons without accessible labels.

---

# 45. Documentation Requirements

Create documentation for:

```text
README.md
ARCHITECTURE.md
SECURITY.md
DEVELOPMENT.md
DEPLOYMENT.md
```

The documentation should explain architectural decisions in plain language.

Whenever you deliberately deviate from an obvious standard approach, document why.

---

# 46. Decision-Making Rule

When choosing between implementations, generally prefer:

1. mature, well-maintained library
2. official platform API
3. simple custom code
4. complex custom infrastructure

Do not write 500 lines of custom code to avoid adding a stable 20 KB dependency.

Conversely, do not add a huge framework for a problem solvable with 30 understandable lines.

---

# 47. Dependency Review Rule

Before adding a significant package, check:

* maintenance activity
* ecosystem maturity
* license
* compatibility with Workers
* compatibility with Bun/Vite
* bundle impact
* known security concerns
* whether it solves a real problem

Prefer established projects.

Do not add dependencies merely because they are fashionable.

---

# 48. What Not to Do

Do not:

* build your own OAuth implementation
* build your own MIME parser
* build your own HTML sanitizer
* store passwords plaintext
* store OAuth secrets in frontend code
* use localStorage for long-lived authentication secrets
* assume all email providers behave the same
* assume Node.js packages automatically work in Workers
* make the whole mailbox synchronize on every HTTP request
* create unnecessary microservices
* create a giant global Vue store containing everything
* use Tailwind to reinvent every UI component
* use custom CSS for things Shadcn/Reka UI already handles well
* silently consume paid Cloudflare services
* over-engineer multi-tenancy for a single-user application
* ignore synchronization failures
* silently discard provider-specific capabilities

---

# 49. Implementation Sequence

Build incrementally.

Recommended order:

## Phase 1 — Foundation

* Vite
* Vue
* TypeScript
* Bun
* Cloudflare Vite plugin
* Hono
* Shadcn/Reka UI
* Tailwind
* linting
* formatting
* testing
* basic project structure

## Phase 2 — Authentication

* GitHub OAuth
* allowed-user verification
* secure session
* login/logout
* protected routes

## Phase 3 — Database

* D1
* migrations
* account model
* mailbox model
* message model
* synchronization metadata

## Phase 4 — First Email Provider

Choose the provider that provides the cleanest path to a reliable first implementation.

Implement:

* connect
* sync
* list
* read
* mark read
* archive/delete
* send
* reply

Do not implement every provider simultaneously.

## Phase 5 — Unified Inbox

* multiple accounts
* account-aware messages
* unified view
* account filters

## Phase 6 — Background Synchronization

* incremental sync
* queues if justified
* cron scheduling if justified
* retry/backoff
* sync status

## Phase 7 — Attachments / Drafts / Rich Compose

* attachments
* drafts
* HTML/plaintext composition
* reply/forward
* signatures if appropriate

## Phase 8 — Notifications

* Service Worker
* Push API
* notification preferences
* duplicate-notification prevention

## Phase 9 — Second Provider

Implement another major provider using the adapter architecture.

Use this to validate that the abstraction is actually good.

## Phase 10 — Hardening

* security review
* performance review
* mobile UX review
* accessibility review
* free-tier review
* failure-mode review
* documentation review

---

# 50. Acceptance Criteria

The project is not complete simply because it compiles.

A first production-quality milestone should allow me to:

1. Open the web application.
2. Log in with my authorized GitHub account.
3. Add at least one email account.
4. Synchronize its mailbox.
5. View messages.
6. Open messages safely.
7. Mark messages read/unread.
8. Archive/delete messages.
9. Compose a message.
10. Send a message.
11. Reply to a message.
12. See attachments.
13. Add another account.
14. See a unified inbox.
15. Receive browser notifications for new mail.
16. Use the application comfortably on a mobile phone.
17. Refresh/restart the application without losing configuration.
18. Recover gracefully from an email-provider authentication failure.
19. Deploy the application to Cloudflare.
20. Understand how to operate the application from the README.

---

# 51. Very Important Agent Behavior

Do not start by writing lots of code.

First inspect:

* official Cloudflare documentation
* official Vite / Vue documentation
* official Hono documentation
* official Shadcn/Reka UI documentation
* official GitHub OAuth documentation
* official Gmail / Google documentation
* official Microsoft documentation
* official documentation for all significant email/protocol libraries you intend to use

Then produce a short implementation proposal containing:

### A. Architecture

Explain the major components.

### B. Data model

Show the important tables and relationships.

### C. Provider strategy

Explain which email provider APIs/protocols will be used and why.

### D. Security model

Explain authentication, authorization, credential storage, sessions, sanitization, and secret management.

### E. Cloudflare resource usage

Explain whether you need:

* D1
* KV
* R2
* Queues
* Cron
* WebSockets/SSE

and why.

### F. Free-tier risks

Identify anything that could become a Free-tier bottleneck.

### G. Important deviations

Tell me explicitly if anything in this prompt conflicts with standard engineering practice.

### H. Dependencies

List significant third-party libraries and explain why each exists.

Only after this proposal is coherent should implementation begin.

---

# 52. Final Principle

Optimize for:

**simple architecture + mature libraries + strong security boundaries + reliable email synchronization + polished UX**

Do not optimize for:

**maximum feature count + minimum number of dependencies + clever code**

When forced to choose between a clever solution and a boring, well-tested, widely understood solution, prefer the boring solution.

If the architecture needs to change because Cloudflare Free-tier limitations or Workers runtime constraints make the original idea impractical, say so clearly and propose the smallest sensible change.
