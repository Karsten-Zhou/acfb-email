// Shared HTML sanitizer for email bodies.
//
// DOMPurify default config strips the `align` attribute on <td>/<th>
// (its allowlist for those elements only permits left/right/justify/char,
// not "center") even though `align="center"` is ubiquitous in email HTML —
// that's how every mail client centers a wrapper table/row. Without it,
// images wrapped in <a> inside <td align="center"> collapse to the left.
//
// We keep the default allowlists (tags/attrs/CSS) but add a hook that
// re-adds `align` for table cells where the plain-text value is safe
// (center/left/right/justify). This is safe: it's a presentational
// attribute that cannot carry scripts or URLs.
import DOMPurify from "dompurify";

const SAFE_ALIGN = new Set(["center", "left", "right", "justify"]);

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof HTMLElement && ["td", "th"].includes(node.tagName.toLowerCase())) {
    const align = node.getAttribute("data-align-safe");
    if (align && SAFE_ALIGN.has(align)) {
      node.setAttribute("align", align);
    }
    node.removeAttribute("data-align-safe");
  }
});

// Re-allow `align` for table cells (DOMPurify's td/th allowlist omits "center").
DOMPurify.addHook("beforeSanitizeAttributes", (node) => {
  if (node instanceof HTMLElement && ["td", "th"].includes(node.tagName.toLowerCase())) {
    const align = node.getAttribute("align");
    if (align && SAFE_ALIGN.has(align.trim().toLowerCase())) {
      // Temp marker so the after-hook can restore it (DOMPurify will strip
      // the original `align` attribute during sanitization).
      node.setAttribute("data-align-safe", align.trim().toLowerCase());
    }
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}