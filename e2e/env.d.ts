// Ambient types for the Workers runtime-only modules used by tests.
// `env` from `cloudflare:workers` is typed as `Cloudflare.Env`; augment it with
// the bindings the tests touch: the D1 DB, a dev secret, and the test-only
// `TEST_MIGRATIONS` binding defined in vitest.config.ts. The production `Env`
// single source is `worker-configuration.d.ts` (server side); tests add only the
// bindings they need so this project doesn't drag in the whole server.
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      CREDENTIAL_ENCRYPTION_KEY: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
