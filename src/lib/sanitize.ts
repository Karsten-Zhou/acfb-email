// Shared HTML sanitizer for email bodies.
//
// Job: many providers reference inline images via `cid:` URLs
// (`<img src="cid:...">`). Browsers cannot resolve those themselves
// (they fail with "Unknown URL scheme"), so we rewrite them to the app's
// attachment endpoint — same-origin, authenticated, streams the binary
// straight from the provider.
//
// DOMPurify parses and sanitizes the email first (RETURN_DOM), then we
// walk its output tree — the exact tree that gets rendered, free of
// scripts/comments/unsafe attributes — and rewrite only real `<img src>`
// via standard DOM APIs. No second parse, no injection surface: the
// replacement URL is built purely from our own attachment ids.
import DOMPurify from "dompurify";

/** One attachment's meta relevant to inline-image resolution. */
export interface InlineAttachment {
  id: string;
  /** The raw Content-ID header value (may include angle brackets). */
  contentId: string | null;
}

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
    let bare = a.contentId.trim();
    if (bare.startsWith("<") && bare.endsWith(">")) bare = bare.slice(1, -1);
    bare = bare.toLowerCase();
    if (bare) byId.set(bare, a.id);
  }
  return byId;
}

export interface SanitizeResult {
  /** The cleaned HTML ready for `v-html`. */
  html: string;
  /** Number of remote images removed because remote images are blocked. */
  blockedRemoteImages: number;
}

/** The `cid:` reference part of an `<img src>` (without the scheme), or null. */
function cidRefFromSrc(src: string | null): string | null {
  if (!src || !src.toLowerCase().startsWith("cid:")) return null;
  return src.slice(4);
}

/**
 * True when an `<img>` src points at an external server (a tracking risk).
 * Resolved against the current page with the DOM URL API: same-origin relative
 * paths (our rewritten attachment endpoint) and non-request schemes (data:,
 * cid:, mailto:, tel:) make no cross-site request and are not remote.
 */
function isRemoteSrc(src: string | null): boolean {
  if (!src) return false;
  const colon = src.indexOf(":");
  const scheme = colon === -1 ? "" : src.slice(0, colon).toLowerCase();
  if (scheme === "data" || scheme === "cid" || scheme === "mailto" || scheme === "tel") {
    return false;
  }
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function sanitizeHtml(
  html: string,
  opts?: {
    /** Message id, used to build the rewrite target URL for inline images. */
    messageId?: string | null;
    /** Attachments whose contentIds may be referenced as `cid:` in the body. */
    attachments?: InlineAttachment[] | null;
    /** Remove external images (privacy). Same-origin attachment images stay. */
    blockRemoteImages?: boolean;
  },
): SanitizeResult {
  // Ask DOMPurify for a DOM (not a string): the tree is already sanitized,
  // so we can walk it safely with standard DOM APIs to rewrite cid: refs.
  const body = DOMPurify.sanitize(html, { RETURN_DOM: true }) as HTMLBodyElement;

  const byId = contentIdToAttachment(opts?.attachments ?? []);
  if (opts?.messageId && byId.size > 0) {
    const base = `/api/messages/${encodeURIComponent(opts.messageId)}/attachments/`;
    for (const img of body.querySelectorAll("img")) {
      const cid = cidRefFromSrc(img.getAttribute("src"));
      const attId = cid ? byId.get(cid.trim().toLowerCase()) : undefined;
      if (attId) img.setAttribute("src", `${base}${encodeURIComponent(attId)}`);
    }
  }

  let blockedRemoteImages = 0;
  if (opts?.blockRemoteImages) {
    for (const img of Array.from(body.querySelectorAll("img"))) {
      if (isRemoteSrc(img.getAttribute("src"))) {
        img.remove();
        blockedRemoteImages++;
      }
    }
  }

  return { html: body.innerHTML, blockedRemoteImages };
}
