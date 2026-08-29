// Mail store: message lists + selection + bulk ops (reactive singleton).
import { reactive } from "vue";
import { api } from "../lib/api";
import type { Message, MessageDetail } from "@shared/types";

interface MailState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  selected: MessageDetail | null;
  selectedIds: Set<string>;
}

export const mailState = reactive<MailState>({
  messages: [],
  loading: false,
  error: null,
  selected: null,
  selectedIds: new Set(),
});

export async function loadMessages(mailboxId: string) {
  mailState.loading = true;
  mailState.error = null;
  try {
    const { messages } = await api.messages(mailboxId);
    mailState.messages = messages;
  } catch (err) {
    mailState.error = err instanceof Error ? err.message : "Failed to load messages";
  } finally {
    mailState.loading = false;
  }
}

export async function loadUnified() {
  mailState.loading = true;
  mailState.error = null;
  try {
    const { messages } = await api.unified();
    mailState.messages = messages;
  } catch (err) {
    mailState.error = err instanceof Error ? err.message : "Failed to load unified inbox";
  } finally {
    mailState.loading = false;
  }
}

export async function openMessage(id: string, mailboxId?: string): Promise<MessageDetail> {
  const { message } = await api.message(id, mailboxId);
  mailState.selected = message;
  if (!message.isRead) {
    await api.flags([id], { read: true });
    const m = mailState.messages.find((x) => x.id === id);
    if (m) m.isRead = true;
    message.isRead = true;
  }
  return message;
}

export async function updateFlags(ids: string[], flags: { read?: boolean; starred?: boolean }) {
  await api.flags(ids, flags);
  for (const m of mailState.messages) {
    if (ids.includes(m.id)) {
      if (flags.read !== undefined) m.isRead = flags.read;
      if (flags.starred !== undefined) m.isStarred = flags.starred;
    }
  }
  if (mailState.selected && ids.includes(mailState.selected.id)) {
    if (flags.read !== undefined) mailState.selected.isRead = flags.read;
    if (flags.starred !== undefined) mailState.selected.isStarred = flags.starred;
  }
}

export async function moveMessages(ids: string[], targetMailboxId: string) {
  await api.move(ids, targetMailboxId);
  mailState.messages = mailState.messages.filter((m) => !ids.includes(m.id));
}

export async function deleteMessages(ids: string[]) {
  await api.delete(ids);
  mailState.messages = mailState.messages.filter((m) => !ids.includes(m.id));
}
