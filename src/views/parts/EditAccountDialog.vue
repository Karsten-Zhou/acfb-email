<script setup lang="ts">
// EditAccountDialog — presentational modal for renaming an account's label +
// display name. State + save logic live in the parent's useEditAccount; this
// component just binds the fields and forwards events.
import { t } from "../../lib/i18n";
import UiButton from "../../components/UiButton.vue";
import UiInput from "../../components/UiInput.vue";
import UiDialog from "../../components/UiDialog.vue";
import { Loader2 } from "@lucide/vue";

defineProps<{
  open: boolean;
  name: string;
  displayName: string;
  error: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:name": [value: string];
  "update:display-name": [value: string];
  save: [];
  close: [];
}>();
</script>

<template>
  <UiDialog :open="open" :title="t('accounts.editAccount')" :busy="busy" @close="emit('close')">
    <div class="space-y-3">
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground">{{ t("accounts.label") }}</label>
        <UiInput
          :model-value="name"
          class="w-full"
          maxlength="100"
          @update:model-value="emit('update:name', String($event))"
        />
        <p class="text-xs text-muted-foreground/70">{{ t("accounts.labelHint") }}</p>
      </div>
      <div class="space-y-1">
        <label class="text-xs font-medium text-muted-foreground">{{
          t("accounts.displayName")
        }}</label>
        <UiInput
          :model-value="displayName"
          class="w-full"
          maxlength="100"
          @update:model-value="emit('update:display-name', String($event))"
        />
        <p class="text-xs text-muted-foreground/70">{{ t("accounts.displayNameHint") }}</p>
      </div>
      <div v-if="error" class="text-xs text-destructive">{{ error }}</div>
    </div>
    <template #footer>
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="emit('close')">{{
        t("common.cancelAction")
      }}</UiButton>
      <UiButton variant="default" size="sm" :disabled="busy" @click="emit('save')">
        <Loader2 v-if="busy" class="h-4 w-4 animate-spin" /> {{ t("common.save") }}
      </UiButton>
    </template>
  </UiDialog>
</template>
