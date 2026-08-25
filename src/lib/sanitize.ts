// Shared HTML sanitizer for email bodies.
//
// Two jobs:
//
// 1. DOMPurify's default allowlist strips `align` on table cells (its td/th
//    list only permits left/right/justify/char, not "center"), yet
//    align="center" is ubiquitous in email HTML for centering wrappers/images.
//    We simply re-allow the presentational `align` attribute on table
//    elements — it carries no script/URL surface, so this is safe.
//
// 2. Many providers reference inline images via `cid:` URLs
//    (`<img src="cid:...">`). Browsers cannot resolve those themselves
//    (they fail with "Unknown URL scheme"), so we rewrite them to the app's
//    attachment endpoint — same-origin, authenticated, streams the binary
//    straight from the provider.
//
//    DOMPurify parses and sanitizes the email first (RETURN_DOM), then we
//    walk its output tree — the exact tree that gets rendered, free of
//    scripts/comments/unsafe attributes — and rewrite only real `<img src>`
//    via standard DOM APIs. No second parse, no injection surface: the
//    replacement URL is built purely from our own attachment ids.
import DOMPurify from "dompurify";

/** One attachment's meta relevant to inline-image resolution. */
export interface InlineAttachment {
  id: string;
  /** The raw Content-ID header value (may include angle brackets). */
  contentId: string | null;
}

const ALIGNABLE = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th"]);

/**
 * Map a Content-ID referenced in HTML `cid:` urls to an attachment id.
 * Matching is lenient on purpose: providers disagree on whether the HTML
 * reference includes the angle brackets from the Content-ID header, so both
 * forms (and lowercase) map to the same attachment.
 */
function contentIdToAttachment(attachments: InlineAttachment[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const a of attachments) {
    if (!a.contentId) continue;
    const bare = a.contentId.trim().replace(/^<|>$/g, "").toLowerCase();
    if (bare) byId.set(bare, a.id);
  }
  return byId;
}

export function sanitizeHtml(
  html: string,
  opts?: {
    /** Message id, used to build the rewrite target URL for inline images. */
    messageId?: string | null;
    /** Attachments whose contentIds may be referenced as `cid:` in the body. */
    attachments?: InlineAttachment[] | null;
  },
): string {
  // Ask DOMPurify for a DOM (not a string): the tree is already sanitized,
  // so we can walk it safely with standard DOM APIs to rewrite cid: refs.
  const body = DOMPurify.sanitize(html, {
    ADD_ATTR: (attr, tag) => attr === "align" && ALIGNABLE.has(tag.toLowerCase()),
    RETURN_DOM: true,
  }) as HTMLBodyElement;

  const byId = contentIdToAttachment(opts?.attachments ?? []);
  if (opts?.messageId && byId.size > 0) {
    const base = `/api/messages/${encodeURIComponent(opts.messageId)}/attachments/`;
    for (const img of body.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      const cid = src?.match(/^cid:(.+)$/i)?.[1];
      const attId = cid ? byId.get(cid.trim().toLowerCase()) : undefined;
      if (attId) img.setAttribute("src", `${base}${encodeURIComponent(attId)}`);
    }
  }
  return body.innerHTML;
}
