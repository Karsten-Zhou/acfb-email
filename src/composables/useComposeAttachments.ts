// Compose attachments: reading selected files client-side into base64. The
// list is metadata-only until send; the API layer uploads them with the
// message. Reusable by any compose UI.
import { ref } from "vue";

export interface ComposeAttachment {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
}

export function useComposeAttachments() {
  const attachments = ref<ComposeAttachment[]>([]);
  const addingFiles = ref(false);
  const fileInput = ref<HTMLInputElement | null>(null);

  function pickFiles() {
    fileInput.value?.click();
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result is a data: URL — strip the prefix.
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function onFilesChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    addingFiles.value = true;
    try {
      for (const f of files) {
        const base64 = await fileToBase64(f);
        attachments.value.push({
          name: f.name,
          mimeType: f.type || "application/octet-stream",
          size: f.size,
          base64,
        });
      }
    } finally {
      addingFiles.value = false;
      if (fileInput.value) fileInput.value.value = "";
    }
  }

  function removeAttachment(i: number) {
    attachments.value.splice(i, 1);
  }

  return { attachments, addingFiles, fileInput, pickFiles, onFilesChosen, removeAttachment };
}
