<script setup lang="ts">
// BulkActions — the bulk operations (mark read, move, delete) that appear
// whenever messages are selected. This is the single source of truth for both
// the desktop list header (MessageListPane) and the mobile top bar
// (MailboxView), so the two surfaces can never drift apart.
import { t } from "../lib/i18n";
import Button from "./UiButton.vue";
import AppTooltip from "./UiToolTip.vue";
import { FolderInput, Trash2 } from "lucide-vue-next";

defineProps<{
  selectedCount: number;
}>();

const emit = defineEmits<{
  "mark-read": [];
  move: [];
  delete: [];
}>();
</script>

<template>
  <template v-if="selectedCount > 0">
    <Button variant="ghost" size="sm" @click="emit('mark-read')">
      {{ t("message.markRead") }}
    </Button>
    <AppTooltip :label="t('message.moveTo')">
      <Button variant="ghost" size="sm" @click="emit('move')">
        <FolderInput class="h-4 w-4" /> {{ t("message.move") }}
      </Button>
    </AppTooltip>
    <Button variant="ghost" size="sm" class="text-destructive" @click="emit('delete')">
      <Trash2 class="h-4 w-4" /> {{ t("common.delete") }} ({{ selectedCount }})
    </Button>
  </template>
</template>
