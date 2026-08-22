// Constructs a concrete provider adapter from persisted account data.
import { decryptCredential } from "../../security/crypto";
import { ImapProvider } from "./imap";
import { GmailProvider } from "./gmail";
import { MicrosoftProvider } from "./microsoft";
import { loadOauthToken } from "../../routes/oauth";
import type { IEmailProvider } from "./types";
import type { Env } from "../../env";

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
): Promise<IEmailProvider> {
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
      // provider never runs with a stale token. Graph/Gmail access tokens
      // expire after ~1h (Microsoft: expires_in ≈ 3600s), and without this
      // the account silently fails auth every few hours.
      const token = await loadOauthToken(env, account, credential.credential);
      if (!token) throw new Error(`Invalid stored OAuth token for ${account.provider}`);
      return account.provider === "gmail"
        ? new GmailProvider(token, account.email)
        : new MicrosoftProvider(token, account.email);
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
