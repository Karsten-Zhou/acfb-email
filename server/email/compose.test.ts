import { describe, it, expect } from "vitest";
import { buildRawMessage } from "./compose";

describe("MIME message building (mimetext)", () => {
  it("builds a plain-text message", () => {
    const raw = buildRawMessage({
      from: { name: "Alice", address: "alice@example.com" },
      to: ["bob@example.com"],
      subject: "Hello",
      text: "Hi Bob",
    });
    const s = new TextDecoder().decode(raw);
    expect(s).toContain("From:");
    expect(s).toContain("To:");
    expect(s).toContain("Subject:");
    expect(s).toContain("Hi Bob");
  });

  it("builds multipart when both html and text present", () => {
    const raw = buildRawMessage({
      from: { name: "Alice", address: "alice@example.com" },
      to: ["bob@example.com"],
      subject: "Hello",
      text: "plain part",
      html: "<p><b>html part</b></p>",
    });
    const s = new TextDecoder().decode(raw);
    expect(s).toContain("multipart/alternative");
    expect(s).toContain("text/plain");
    expect(s).toContain("text/html");
  });

  it("adds In-Reply-To and References", () => {
    const raw = buildRawMessage({
      from: { name: "Alice", address: "alice@example.com" },
      to: ["bob@example.com"],
      subject: "Re: Hello",
      text: "re",
      inReplyTo: "<orig@example.com>",
      references: ["<orig@example.com>", "<prev@example.com>"],
    });
    const s = new TextDecoder().decode(raw);
    expect(s).toContain("In-Reply-To: <orig@example.com>");
    expect(s).toContain("References: <orig@example.com> <prev@example.com>");
  });

  it("folds base64 attachments into <=76-char lines (RFC 2045)", () => {
    // ~240KB of base64 — mimetext does not fold it, so a raw dump would be a
    // single line exceeding the 998-octet SMTP limit (RFC 5321) and the mail
    // server would reject it with "Line too long".
    const bigB64 = "aGVsbG8=".repeat(30000);
    const raw = buildRawMessage({
      from: { name: "Alice", address: "alice@example.com" },
      to: ["bob@example.com"],
      subject: "Big attachment",
      text: "body",
      attachments: [{ filename: "big.bin", contentType: "application/octet-stream", base64: bigB64 }],
    });
    const s = new TextDecoder().decode(raw);
    const maxOctets = Math.max(...s.split("\r\n").map((l) => l.length));
    expect(maxOctets).toBeLessThanOrEqual(76);
  });

  it("uses CRLF line endings throughout (RFC 5322; Workerd's os.EOL is LF)", () => {
    const raw = buildRawMessage({
      from: { name: "Alice", address: "alice@example.com" },
      to: ["bob@example.com"],
      subject: "Hello",
      text: "line one\nline two",
      attachments: [{ filename: "a.txt", contentType: "text/plain", base64: "aGVsbG8=" }],
    });
    const s = new TextDecoder().decode(raw);
    // Every line break must be CRLF — no bare LF line endings.
    expect(s).not.toMatch(/(^|[^\r])\n/);
    expect(s.includes("\r\n")).toBe(true);
  });
});
