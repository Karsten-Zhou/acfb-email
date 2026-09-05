// HTTP API payload types shared by the server (producer) and client (consumer)
// that don't map to a single row or a Zod input schema.

/** GET /api/health payload. */
export interface HealthPayload {
  ok: boolean;
  config: {
    gmailOauth: boolean;
    outlookOauth: boolean;
  };
}

/** One row of the Web Push subscription list (keys redacted). */
export interface PushSubscriptionSummary {
  id: string;
  endpoint: string;
  enabled: number;
  created_at: string;
}

/** GET /api/push/capability payload. */
export interface PushCapability {
  configured: boolean;
  publicKey: string | null;
  subscriptions: PushSubscriptionSummary[];
}
