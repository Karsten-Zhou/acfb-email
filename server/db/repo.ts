// Repository layer: all D1 access for email entities, scoped by user ownership.
import { randomUUID } from "crypto";
import type { Env } from "../env";

export interface MailboxRow {
  id: string;
  account_id: string;
  provider_path: string;
}

export interface AccountRow {
  id: string;
  provider: string;
  email: string;
  display_name: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: number | null;
  state: string;
  state_message: string | null;
  name: string;
  created_at: string;
  last_synced_at: string | null;
  sync_enabled: number;
}

export interface MessageRow {
  id: string;
  account_id: string;
  mailbox_id: string;
  remote_uid: number | null;
  remote_message_id: string | null;
  subject: string | null;
  snippet: string | null;
  from_name: string | null;
  from_address: string | null;
  date: string | null;
  received_at: string;
  is_read: number;
  is_starred: number;
  has_attachments: number;
  maybe_thread_id: string | null;
  html_preview: string | null;
  text_preview: string | null;
  body_fetched: number;
  provider_path: string;
  account_email: string;
  account_name: string;
}

export const repo = {
  // --- accounts ---
  async accountForUser(env: Env, userId: string, accountId: string): Promise<AccountRow | null> {
    return env.DB.prepare(
      `SELECT id, provider, email, display_name, imap_host, imap_port, imap_secure,
              smtp_host, smtp_port, smtp_secure, state, state_message, name, created_at,
              last_synced_at, sync_enabled
       FROM accounts WHERE id = ? AND user_id = ?`,
    )
      .bind(accountId, userId)
      .first<AccountRow>();
  },

  async accountById(env: Env, accountId: string): Promise<AccountRow | null> {
    return env.DB.prepare(
      `SELECT id, provider, email, display_name, imap_host, imap_port, imap_secure,
              smtp_host, smtp_port, smtp_secure, state, state_message, name, created_at,
              last_synced_at, sync_enabled
       FROM accounts WHERE id = ?`,
    )
      .bind(accountId)
      .first<AccountRow>();
  },

  async credential(env: Env, accountId: string): Promise<string | null> {
    const row = await env.DB.prepare(
      `SELECT credential FROM account_credentials WHERE account_id = ?`,
    )
      .bind(accountId)
      .first<{ credential: string }>();
    return row?.credential ?? null;
  },

  // --- mailboxes ---
  async mailboxForUser(env: Env, userId: string, mailboxId: string): Promise<MailboxRow | null> {
    return env.DB.prepare(
      `SELECT m.id, m.account_id, m.provider_path
       FROM mailboxes m JOIN accounts a ON a.id = m.account_id
       WHERE m.id = ? AND a.user_id = ?`,
    )
      .bind(mailboxId, userId)
      .first<MailboxRow>();
  },

  async mailboxById(env: Env, mailboxId: string): Promise<MailboxRow | null> {
    return env.DB.prepare(`SELECT id, account_id, provider_path FROM mailboxes WHERE id = ?`)
      .bind(mailboxId)
      .first<MailboxRow>();
  },

  // --- messages ---
  async listMessages(
    env: Env,
    mailboxId: string,
    limit: number,
    offset: number,
  ): Promise<MessageRow[]> {
    const rows = await env.DB.prepare(
      `SELECT m.id, m.account_id, m.mailbox_id, m.remote_uid, m.remote_message_id, m.subject,
              m.snippet, m.from_name, m.from_address, m.date, m.received_at, m.is_read,
              m.is_starred, m.has_attachments, m.maybe_thread_id, m.html_preview, m.text_preview,
              m.body_fetched, mb.provider_path, a.email AS account_email, a.name AS account_name
       FROM messages m
       JOIN mailboxes mb ON mb.id = m.mailbox_id
       JOIN accounts a ON a.id = m.account_id
       WHERE m.mailbox_id = ?
       ORDER BY m.received_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(mailboxId, limit, offset)
      .all<MessageRow>();
    return rows.results;
  },

  async unifiedMessages(
    env: Env,
    mailboxIds: string[],
    limit: number,
    offset: number,
  ): Promise<MessageRow[]> {
    if (mailboxIds.length === 0) return [];
    const ph = mailboxIds.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT m.id, m.account_id, m.mailbox_id, m.remote_uid, m.remote_message_id, m.subject,
              m.snippet, m.from_name, m.from_address, m.date, m.received_at, m.is_read,
              m.is_starred, m.has_attachments, m.maybe_thread_id, m.html_preview, m.text_preview,
              m.body_fetched, mb.provider_path, a.email AS account_email, a.name AS account_name
       FROM messages m
       JOIN mailboxes mb ON mb.id = m.mailbox_id
       JOIN accounts a ON a.id = m.account_id
       WHERE m.mailbox_id IN (${ph})
       ORDER BY m.received_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...mailboxIds, limit, offset)
      .all<MessageRow>();
    return rows.results;
  },

  async messageForUser(env: Env, userId: string, messageId: string): Promise<MessageRow | null> {
    return env.DB.prepare(
      `SELECT m.id, m.account_id, m.mailbox_id, m.remote_uid, m.remote_message_id, m.subject,
              m.snippet, m.from_name, m.from_address, m.date, m.received_at, m.is_read,
              m.is_starred, m.has_attachments, m.maybe_thread_id, m.html_preview, m.text_preview,
              m.body_fetched, mb.provider_path, a.email AS account_email, a.name AS account_name
       FROM messages m
       JOIN mailboxes mb ON mb.id = m.mailbox_id
       JOIN accounts a ON a.id = m.account_id
       WHERE m.id = ? AND a.user_id = ?`,
    )
      .bind(messageId, userId)
      .first<MessageRow>();
  },

  async ownedMessageIds(
    env: Env,
    userId: string,
    ids: string[],
  ): Promise<
    {
      id: string;
      mailbox_id: string;
      remote_message_id: string | null;
      remote_uid: number | null;
    }[]
  > {
    if (ids.length === 0) return [];
    const ph = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT m.id, m.mailbox_id, m.remote_message_id, m.remote_uid
       FROM messages m JOIN accounts a ON a.id = m.account_id
       WHERE m.id IN (${ph}) AND a.user_id = ?`,
    )
      .bind(...ids, userId)
      .all<{
        id: string;
        mailbox_id: string;
        remote_message_id: string | null;
        remote_uid: number | null;
      }>();
    return rows.results;
  },

  async recipients(
    env: Env,
    messageId: string,
  ): Promise<{ type: string; name: string | null; address: string }[]> {
    const rows = await env.DB.prepare(
      `SELECT type, name, address FROM message_recipients WHERE message_id = ?`,
    )
      .bind(messageId)
      .all<{ type: string; name: string | null; address: string }>();
    return rows.results;
  },

  async attachments(
    env: Env,
    messageId: string,
  ): Promise<
    {
      id: string;
      filename: string | null;
      mime_type: string;
      size: number;
      is_inline: number;
      content_id: string | null;
      disposition: string | null;
      part_number: string | null;
    }[]
  > {
    const rows = await env.DB.prepare(
      `SELECT id, filename, mime_type, size, is_inline, content_id, disposition, part_number FROM attachments WHERE message_id = ? ORDER BY rowid ASC`,
    )
      .bind(messageId)
      .all();
    return rows.results as never;
  },

  /**
   * Replace the attachment metadata rows for a message (used when a body is
   * fetched/re-fetched). Keeps the set in sync with the provider parse.
   */
  async replaceAttachments(
    env: Env,
    messageId: string,
    attachments: {
      filename: string | null;
      mime_type: string;
      size: number;
      is_inline: number;
      content_id: string | null;
      disposition: string | null;
      part_number: string | null;
    }[],
  ): Promise<void> {
    if (attachments.length === 0) return;
    await env.DB.prepare(`DELETE FROM attachments WHERE message_id = ?`).bind(messageId).run();
    for (const a of attachments) {
      await env.DB.prepare(
        `INSERT INTO attachments (id, message_id, filename, mime_type, size, is_inline, content_id, disposition, part_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          randomUUID(),
          messageId,
          a.filename,
          a.mime_type,
          a.size,
          a.is_inline,
          a.content_id,
          a.disposition,
          a.part_number,
        )
        .run();
    }
  },

  /** A message's attachment row by id (ownership already scoped by message). */
  async attachmentById(
    env: Env,
    attachmentId: string,
  ): Promise<{
    id: string;
    message_id: string;
    filename: string | null;
    mime_type: string;
    size: number;
    is_inline: number;
    content_id: string | null;
    disposition: string | null;
    part_number: string | null;
  } | null> {
    return env.DB.prepare(
      `SELECT id, message_id, filename, mime_type, size, is_inline, content_id, disposition, part_number
       FROM attachments WHERE id = ?`,
    )
      .bind(attachmentId)
      .first();
  },

  async markBodyFetched(
    env: Env,
    messageId: string,
    html: string | null,
    text: string | null,
  ): Promise<void> {
    await env.DB.prepare(
      `UPDATE messages SET html_preview = ?, text_preview = ?, body_fetched = 1 WHERE id = ?`,
    )
      .bind(html, text, messageId)
      .run();
  },

  async updateFlags(
    env: Env,
    messageId: string,
    flags: { read?: boolean; starred?: boolean },
  ): Promise<void> {
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    if (flags.read !== undefined) {
      sets.push("is_read = ?");
      vals.push(flags.read ? 1 : 0);
    }
    if (flags.starred !== undefined) {
      sets.push("is_starred = ?");
      vals.push(flags.starred ? 1 : 0);
    }
    if (sets.length === 0) return;
    vals.push(messageId);
    await env.DB.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...vals)
      .run();
  },

  /** Recompute a mailbox's unseen count from its current messages. */
  async refreshUnseen(env: Env, mailboxId: string): Promise<void> {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM messages WHERE mailbox_id = ? AND is_read = 0`,
    )
      .bind(mailboxId)
      .first<{ n: number }>();
    await env.DB.prepare(`UPDATE mailboxes SET unseen_messages = ? WHERE id = ?`)
      .bind(r?.n ?? 0, mailboxId)
      .run();
  },

  async moveMessage(env: Env, messageId: string, mailboxId: string): Promise<void> {
    await env.DB.prepare(`UPDATE messages SET mailbox_id = ? WHERE id = ?`)
      .bind(mailboxId, messageId)
      .run();
  },

  async deleteMessage(env: Env, messageId: string): Promise<void> {
    await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(messageId).run();
  },
};
