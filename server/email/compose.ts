// Build an RFC5322 MIME message for sending, using mimetext.
import { createMimeMessage } from "mimetext";

export interface ComposeInput {
  from: { name: string | null; address: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: { filename: string; contentType: string; base64: string }[];
}

export function buildRawMessage(input: ComposeInput): Uint8Array {
  const msg = createMimeMessage();
  msg.setSender({ name: input.from.name ?? undefined, addr: input.from.address });
  for (const t of input.to) msg.setTo(t);
  for (const t of input.cc ?? []) msg.setCc(t);
  for (const t of input.bcc ?? []) msg.setBcc(t);
  msg.setSubject(input.subject);

  if (input.inReplyTo) {
    // mimetext expects a bare Message-ID (no angle brackets).
    const bare = input.inReplyTo.replace(/^<|>$/g, "");
    msg.setHeader("In-Reply-To", `<${bare}>`);
  }
  if (input.references && input.references.length > 0) {
    const refs = input.references
      .map((r) => r.replace(/^<|>$/g, ""))
      .map((r) => `<${r}>`)
      .join(" ");
    msg.setHeader("References", refs);
  }

  const hasHtml = !!input.html;
  const hasText = !!input.text;
  const useMultipart = hasHtml && hasText;

  if (useMultipart) {
    msg.addMessage({ contentType: "text/plain", data: input.text as string });
    msg.addMessage({ contentType: "text/html", data: input.html as string });
  } else if (hasHtml) {
    msg.addMessage({ contentType: "text/html", data: input.html as string });
  } else if (hasText) {
    msg.addMessage({ contentType: "text/plain", data: input.text as string });
  } else {
    msg.addMessage({ contentType: "text/plain", data: "" });
  }

  for (const a of input.attachments ?? []) {
    msg.addAttachment({
      filename: a.filename,
      contentType: a.contentType,
      data: foldBase64(a.base64),
      encoding: "base64",
    });
  }

  const raw = msg.asRaw();
  // mimetext's node entry uses `os.EOL`, which is bare LF on Linux/Workerd.
  // RFC 5322/SMTP require CRLF line endings, and mimetext does not fold base64
  // itself — a large attachment would otherwise be one giant line that exceeds
  // the 998-octet SMTP limit (RFC 5321) and get rejected with "Line too long".
  // Normalize every line ending to CRLF so headers, body and the folded base64
  // attachment are transmitted consistently.
  return new TextEncoder().encode(raw.replace(/\r?\n/g, "\r\n"));
}

/** Wrap base64 into RFC 2045 76-char lines (required for MIME attachments). */
function foldBase64(base64: string): string {
  const clean = base64.replace(/\s+/g, "");
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += 76) lines.push(clean.slice(i, i + 76));
  return lines.join("\n");
}
