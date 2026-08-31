<script setup lang="ts">
// RemoteImagesBanner — the "images blocked" notice shown above an email body
// when remote images are hidden. A "Load images this time" button + a dropdown
// ("allow from this sender" / "always load"). Only rendered by the parent when
// the message actually had remote images blocked.
import { t } from "../../lib/i18n";
import { useOverflowMenu } from "../../composables/useOverflowMenu";
import Button from "../../components/UiButton.vue";
import AppTooltip from "../../components/UiToolTip.vue";
import { ImageOff, ChevronDown } from "@lucide/vue";

const emit = defineEmits<{
  "load-this-time": [];
  "allow-from-sender": [];
  "always-allow": [];
}>();

const { open, triggerEl, menuEl, pos, toggle, close } = useOverflowMenu();

function pickAllowSender() {
  close();
  emit("allow-from-sender");
}
function pickAlwaysAllow() {
  close();
  emit("always-allow");
}
</script>

<template>
  <div class="mb-4 rounded-md border border-border bg-muted/40 p-3">
    <div class="flex items-start gap-2.5">
      <ImageOff class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ t("message.imagesBlockedTitle") }}</p>
        <p class="text-xs text-muted-foreground">{{ t("message.imagesBlockedBody") }}</p>
      </div>
    </div>
    <div class="mt-3 flex items-center gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        class="flex-1 sm:flex-none"
        @click="emit('load-this-time')"
      >
        {{ t("message.loadImagesThisTime") }}
      </Button>
      <div ref="triggerEl" class="relative">
        <AppTooltip :label="t('common.moreActions')">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-haspopup="true"
            :aria-expanded="open"
            @click="toggle"
          >
            <ChevronDown class="h-4 w-4" />
          </Button>
        </AppTooltip>
        <Teleport to="body">
          <Transition
            enter-active-class="transition-opacity duration-75"
            leave-active-class="transition-opacity duration-75"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <div
              v-if="open"
              ref="menuEl"
              role="menu"
              class="fixed z-100 w-60 rounded-md border border-border bg-popover p-1 shadow-md"
              :style="pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined"
            >
              <button
                role="menuitem"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                @click="pickAllowSender"
              >
                {{ t("message.allowFromSender") }}
              </button>
              <button
                role="menuitem"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                @click="pickAlwaysAllow"
              >
                {{ t("message.alwaysAllowImages") }}
              </button>
            </div>
          </Transition>
        </Teleport>
      </div>
    </div>
  </div>
</template>
