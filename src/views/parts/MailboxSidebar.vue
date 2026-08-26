<script setup lang="ts">
// MailboxSidebar — account list + mailbox tree + per-account sync buttons.
// Desktop: a static column in the 3-pane layout (md+).
// Mobile: rendered as a slide-in drawer toggled by `open` (with a backdrop).
import { useRouter } from "vue-router";
import { accountsState } from "../../stores/accounts";
import { t } from "../../lib/i18n";
import Button from "../../components/UiButton.vue";
import AppTooltip from "../../components/UiToolTip.vue";
import {
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  AlertTriangle,
  RefreshCw,
  Plus,
  Mail as MailIcon,
  Settings,
} from "lucide-vue-next";
import type { Mailbox } from "@shared/types";

defineProps<{
  mailboxes: { accountId: string; accountName: string; accountEmail: string; mailbox: Mailbox }[];
  activeMailboxId: string | null;
  syncing: boolean;
  unread: (item: { mailbox: Mailbox }) => number;
  /** Mobile drawer open state (ignored on md+). */
  open: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  "sync-all": [];
  "sync-account": [id: string];
  close: [];
}>();

const router = useRouter();

const roleIcon: Record<string, typeof Inbox> = {
  inbox: Inbox,
  all: MailIcon,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: AlertTriangle,
  trash: Trash2,
};
</script>

<template>
  <!-- Mobile backdrop (below md) — fades in with the drawer. -->
  <Transition
    enter-active-class="transition-opacity duration-300 ease-out"
    leave-active-class="transition-opacity duration-200 ease-in"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div v-if="open" class="fixed inset-0 z-30 bg-black/50 md:hidden" @click="emit('close')" />
  </Transition>
  <!-- Mobile drawer: always rendered as a fixed overlay that slides in from
       the left when `open` (translate + visibility so the slide-out animates
       too); on md+ it becomes the static column of the pane layout. -->
  <aside
    class="flex w-64 shrink-0 flex-col border-r border-border bg-card fixed inset-y-0 left-0 z-40 shadow-2xl transition-[translate,visibility] duration-300 ease-out md:static md:flex md:translate-x-0 md:visible md:shadow-none"
    :class="open ? 'translate-x-0 visible' : '-translate-x-full invisible'"
  >
    <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
      <span class="text-sm font-semibold tracking-tight">Mail</span>
      <div class="flex items-center gap-1">
        <AppTooltip :label="t('syncNow')">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            :disabled="syncing"
            @click="emit('sync-all')"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" />
          </Button>
        </AppTooltip>
        <AppTooltip :label="t('settings')">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            @click="router.push({ name: 'settings' })"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </AppTooltip>
      </div>
    </div>

    <div class="px-3 py-2">
      <Button class="w-full" variant="default" size="sm" @click="router.push({ name: 'compose' })">
        <Plus class="h-4 w-4" /> Compose
      </Button>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
      <button
        class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
        :class="activeMailboxId === 'unified' ? 'bg-accent text-accent-foreground' : ''"
        @click="emit('select', 'unified')"
      >
        <MailIcon class="h-4 w-4 shrink-0" />
        <span class="grow text-left">{{ t("unifiedInbox") }}</span>
      </button>

      <!-- Empty state: guide the user to add an account in Settings. -->
      <div
        v-if="accountsState.accounts.length === 0"
        class="mt-6 space-y-3 rounded-lg border border-dashed border-border p-4 text-center"
      >
        <p class="text-sm font-medium text-foreground/80">{{ t("noAccountsTitle") }}</p>
        <p class="text-xs leading-relaxed text-muted-foreground">{{ t("noAccountsHint") }}</p>
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          @click="router.push({ name: 'settings' })"
        >
          <Settings class="h-4 w-4" /> {{ t("settings") }}
        </Button>
      </div>

      <template v-for="acct in accountsState.accounts" :key="acct.id">
        <div
          class="mt-4 mb-0.5 flex items-center justify-between px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {{ acct.name }}
          <AppTooltip :label="acct.state === 'running' ? t('syncing') : t('syncNow')">
            <button
              class="rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              :disabled="acct.state === 'running'"
              @click.stop="emit('sync-account', acct.id)"
            >
              <RefreshCw v-if="acct.state === 'running'" class="h-3 w-3 animate-spin" />
              <RefreshCw v-else class="h-3 w-3" />
            </button>
          </AppTooltip>
        </div>
        <button
          v-for="item in mailboxes.filter((t) => t.accountId === acct.id)"
          :key="item.mailbox.id"
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
          :class="activeMailboxId === item.mailbox.id ? 'bg-accent text-accent-foreground' : ''"
          @click="emit('select', item.mailbox.id)"
        >
          <component :is="roleIcon[item.mailbox.role] || Inbox" class="h-4 w-4 shrink-0" />
          <span class="grow truncate text-left">{{ item.mailbox.name }}</span>
          <span
            v-if="unread(item)"
            class="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
          >
            {{ unread(item) }}
          </span>
        </button>
      </template>
    </nav>
  </aside>
</template>
