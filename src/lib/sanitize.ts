// Shared HTML sanitizer for email bodies.
//
// DOMPurify's default allowlist strips `align` on table cells (its td/th
// list only permits left/right/justify/char, not "center"), yet
// align="center" is ubiquitous in email HTML for centering wrappers/images.
// We simply re-allow the presentational `align` attribute on table
// elements — it carries no script/URL surface, so this is safe.
import DOMPurify from "dompurify";

const ALIGNABLE = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th"]);

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: (attr, tag) => attr === "align" && ALIGNABLE.has(tag.toLowerCase()),
  });
}
