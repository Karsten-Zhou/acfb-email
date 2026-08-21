import { describe, it, expect } from "vitest";
import { roleFromImapName, roleSortOrder } from "./role-map";

describe("IMAP mailbox role mapping", () => {
  it("maps standard names", () => {
    expect(roleFromImapName("INBOX", [])).toBe("inbox");
    expect(roleFromImapName("Sent", [])).toBe("sent");
    expect(roleFromImapName("Sent Items", [])).toBe("sent");
    expect(roleFromImapName("[Gmail]/Sent Mail", [])).toBe("sent");
    expect(roleFromImapName("Drafts", [])).toBe("drafts");
    expect(roleFromImapName("Trash", [])).toBe("trash");
    expect(roleFromImapName("Deleted Items", [])).toBe("trash");
    expect(roleFromImapName("Junk", [])).toBe("spam");
    expect(roleFromImapName("[Gmail]/Spam", [])).toBe("spam");
    expect(roleFromImapName("[Gmail]/All Mail", [])).toBe("all");
    expect(roleFromImapName("Archive", [])).toBe("archive");
    expect(roleFromImapName("Custom Folder", [])).toBe("other");
  });

  it("respects provider flags", () => {
    expect(roleFromImapName("Whatever", ["\\Sent"])).toBe("sent");
    expect(roleFromImapName("Whatever", ["\\Trash"])).toBe("trash");
    expect(roleFromImapName("Whatever", ["\\All"])).toBe("all");
  });

  it("sorts roles correctly", () => {
    expect(roleSortOrder("inbox")).toBeLessThan(roleSortOrder("sent"));
    expect(roleSortOrder("sent")).toBeLessThan(roleSortOrder("trash"));
    expect(roleSortOrder("other")).toBeGreaterThan(roleSortOrder("trash"));
  });
});