<script setup lang="ts">
// RichTextEditor — Tiptap wrapper for the compose body. Keeps a focused set of
// email-safe formats: bold, italic, underline, lists and text color, plus
// undo/redo. Headings, code, quotes, strike and links stay disabled so the
// editor stays plain and predictable.
// Content is HTML via v-model; callers get the plain-text rendering through
// the exposed getText() (used for the text/plain MIME part on send).
import { ref, watch } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Button from "./UiButton.vue";
import AppTooltip from "./UiToolTip.vue";
import { t } from "../lib/i18n";
import { cn } from "../lib/cn";
import { Bold, Italic, Underline, List, ListOrdered, Undo2, Redo2 } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
  }>(),
  { placeholder: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      link: false,
      strike: false,
    }),
    TextStyle,
    Color,
    Placeholder.configure({ placeholder: props.placeholder ?? "" }),
  ],
  content: props.modelValue,
  editorProps: {
    attributes: {
      class: "min-h-[260px] px-3 py-2 text-sm focus:outline-none",
    },
  },
  onUpdate: ({ editor: e }) => emit("update:modelValue", e.getHTML()),
});

// Re-populate the editor when the parent sets content after mount (loading a
// saved draft). The equality guard prevents the watch from fighting onUpdate.
watch(
  () => props.modelValue,
  (html) => {
    if (!editor.value || html === editor.value.getHTML()) return;
    editor.value.commands.setContent(html, { emitUpdate: false });
  },
);

/** Last-picked text color (sticks across the session for the swatch). */
const textColor = ref("#000000");

function setTextColor(e: Event) {
  const color = (e.target as HTMLInputElement).value;
  textColor.value = color;
  editor.value?.chain().focus().setColor(color).run();
}

defineExpose({
  /** Plain-text rendering of the current body (for the text/plain MIME part). */
  getText: () => editor.value?.getText() ?? "",
});
</script>

<template>
  <div class="rounded-md border border-input bg-background">
    <div class="flex flex-wrap items-center gap-x-0.5 gap-y-1 border-b border-border px-2 py-1">
      <slot name="toolbar" />
      <span class="mx-1 h-4 w-px shrink-0 bg-border" />
      <AppTooltip :label="t('bold')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="cn(editor?.isActive('bold') && 'bg-accent text-accent-foreground')"
          @mousedown.prevent
          @click="editor?.chain().focus().toggleBold().run()"
        >
          <Bold class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <AppTooltip :label="t('italic')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="cn(editor?.isActive('italic') && 'bg-accent text-accent-foreground')"
          @mousedown.prevent
          @click="editor?.chain().focus().toggleItalic().run()"
        >
          <Italic class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <AppTooltip :label="t('underline')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="cn(editor?.isActive('underline') && 'bg-accent text-accent-foreground')"
          @mousedown.prevent
          @click="editor?.chain().focus().toggleUnderline().run()"
        >
          <Underline class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <span class="mx-1 h-4 w-px shrink-0 bg-border" />
      <AppTooltip :label="t('unorderedList')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="cn(editor?.isActive('bulletList') && 'bg-accent text-accent-foreground')"
          @mousedown.prevent
          @click="editor?.chain().focus().toggleBulletList().run()"
        >
          <List class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <AppTooltip :label="t('orderedList')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :class="cn(editor?.isActive('orderedList') && 'bg-accent text-accent-foreground')"
          @mousedown.prevent
          @click="editor?.chain().focus().toggleOrderedList().run()"
        >
          <ListOrdered class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <span class="mx-1 h-4 w-px shrink-0 bg-border" />
      <AppTooltip :label="t('textColor')">
        <span
          class="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent"
        >
          <span class="text-sm font-semibold leading-none">A</span>
          <span
            class="absolute inset-x-1 bottom-1 h-0.5 rounded-full"
            :style="{ backgroundColor: textColor }"
          />
          <input
            type="color"
            class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            :value="textColor"
            :aria-label="t('textColor')"
            @input="setTextColor"
          />
        </span>
      </AppTooltip>
      <span class="mx-1 h-4 w-px shrink-0 bg-border" />
      <AppTooltip :label="t('undo')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :disabled="!editor?.can().undo()"
          @mousedown.prevent
          @click="editor?.chain().focus().undo().run()"
        >
          <Undo2 class="h-4 w-4" />
        </Button>
      </AppTooltip>
      <AppTooltip :label="t('redo')">
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :disabled="!editor?.can().redo()"
          @mousedown.prevent
          @click="editor?.chain().focus().redo().run()"
        >
          <Redo2 class="h-4 w-4" />
        </Button>
      </AppTooltip>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>

<style>
/* Placeholder shown inside an empty body (Tiptap adds .is-editor-empty). */
.tiptap p.is-editor-empty:first-child::before {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

/* Tailwind's preflight strips list markers/indent; restore them in the editor
   so bulleted/numbered lists render as expected. */
.tiptap ul {
  list-style: disc;
  padding-left: 1.25rem;
}
.tiptap ol {
  list-style: decimal;
  padding-left: 1.25rem;
}
.tiptap li > p {
  margin: 0;
}
</style>
