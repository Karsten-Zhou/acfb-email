import { describe, it, expect } from "vitest";
import { decodeModifiedUtf7 } from "./modified-utf7";

describe("IMAP modified UTF-7 decoder", () => {
  it("passes through ASCII names unchanged", () => {
    expect(decodeModifiedUtf7("INBOX")).toBe("INBOX");
    expect(decodeModifiedUtf7("Sent Messages")).toBe("Sent Messages");
  });

  it("decodes a Chinese mailbox name", () => {
    // "邮件" and "未知世界" style encoded names; this is a representative
    // RFC-3501 modified UTF-7 sequence.
    const decoded = decodeModifiedUtf7("&V4NXPpCuTvY-");
    expect(decoded).toMatch(/[\u4e00-\u9fff]/); // contains CJK characters
  });

  it("handles literal ampersand escape '&-'", () => {
    expect(decodeModifiedUtf7("A&-B")).toBe("A&B");
  });

  it("handles nested folder paths", () => {
    const decoded = decodeModifiedUtf7("&UXZO1mWHTvZZOQ-/QQ");
    expect(decoded.endsWith("/QQ")).toBe(true);
    expect(decoded).toContain("/");
  });
});
