// Constructs a concrete provider adapter from persisted account data. All
// providers run through the IMAP/SMTP adapter; Gmail and Outlook connect via
// OAuth2 (XOAUTH2) on their well-known endpoints.
import { decryptCredential } from "../security/crypto";
import { ImapProvider } from "./imap";
import { loadOauthToken } from "../routes/oauth";
import type { ImapTransport } from "./imap";
import type { Env } from "../env";

// Well-known IMAP/SMTP endpoints for OAuth-connected providers. Gmail and
// Outlook disable password login, so these accounts always authenticate with
// an OAuth2 access token (XOAUTH2) over the standard submission ports.
const OAUTH_TRANSPORTS: Record<"gmail" | "microsoft", ImapTransport> = {
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  microsoft: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
  },
};

export interface AccountLike {
  id: string;
  provider: string;
  email: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: number | null;
}

export interface CredentialLike {
  credential: string;
}

export async function buildProvider(
  account: AccountLike,
  credential: CredentialLike | null,
  env: Env,
): Promise<ImapProvider> {
  switch (account.provider) {
    case "imap": {
      if (!credential) throw new Error("Missing credentials for IMAP account");
      if (!account.imap_host || !account.smtp_host || !account.imap_port || !account.smtp_port) {
        throw new Error("Incomplete IMAP/SMTP configuration");
      }
      const { username, password } = await decryptedImap(credential.credential, env);
      return new ImapProvider(
        {
          imapHost: account.imap_host,
          imapPort: account.imap_port,
          imapSecure: account.imap_secure !== 0,
          smtpHost: account.smtp_host,
          smtpPort: account.smtp_port,
          smtpSecure: account.smtp_secure !== 0,
        },
        { username, password },
        account.email,
      );
    }
    case "gmail":
    case "microsoft": {
      if (!credential) throw new Error(`Missing OAuth token for ${account.provider}`);
      // Refresh an expired access token (and persist the fresh one) so the
      // provider never runs with a stale token (Gmail/Outlook access tokens
      // expire after ~1h).
      const token = await loadOauthToken(env, account, credential.credential);
      if (!token) throw new Error(`Invalid stored OAuth token for ${account.provider}`);
      return new ImapProvider(
        OAUTH_TRANSPORTS[account.provider],
        { username: account.email, accessToken: token.access_token },
        account.email,
      );
    }
    default:
      throw new Error(`Provider "${account.provider}" is not implemented yet`);
  }
}

interface ImapPlainCreds {
  username: string;
  password: string;
}

async function decryptedImap(blob: string, env: Env): Promise<ImapPlainCreds> {
  const plain = await decryptCredential(blob, env.CREDENTIAL_ENCRYPTION_KEY);
  try {
    const parsed = JSON.parse(plain);
    if (typeof parsed.username === "string" && typeof parsed.password === "string") {
      return { username: parsed.username, password: parsed.password };
    }
  } catch {
    /* invalid */
  }
  throw new Error("Invalid stored credential format");
}
