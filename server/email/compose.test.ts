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
});
