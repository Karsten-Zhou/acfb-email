import { describe, it, expect } from "vitest";
import { roleFromImapName, roleSortOrder } from "./role-map";

describe("IMAP mailbox role mapping", () => {
  it("maps INBOX by its reserved name", () => {
    expect(roleFromImapName("INBOX", [])).toBe("inbox");
    expect(roleFromImapName("inbox", ["\\HasNoChildren"])).toBe("inbox");
  });

  it("maps roles from SPECIAL-USE flags, not folder names", () => {
    expect(roleFromImapName("Sent", ["\\Sent"])).toBe("sent");
    expect(roleFromImapName("[Gmail]/Sent Mail", ["\\Sent"])).toBe("sent");
    expect(roleFromImapName("Drafts", ["\\Drafts"])).toBe("drafts");
    expect(roleFromImapName("Deleted", ["\\Trash"])).toBe("trash");
    expect(roleFromImapName("Junk", ["\\Junk"])).toBe("spam");
    expect(roleFromImapName("[Gmail]/All Mail", ["\\All"])).toBe("all");
    // \Flagged (Gmail Starred) has no mapped role.
    expect(roleFromImapName("[Gmail]/Starred", ["\\Flagged"])).toBe("other");
  });

  it("leaves folders without SPECIAL-USE as other, even when the name looks special", () => {
    expect(roleFromImapName("Sent Items", [])).toBe("other");
    expect(roleFromImapName("Trash", [])).toBe("other");
    expect(roleFromImapName("Deleted Items", [])).toBe("other");
    expect(roleFromImapName("[Gmail]/Spam", [])).toBe("other");
    expect(roleFromImapName("Archive", [])).toBe("other");
    expect(roleFromImapName("Custom Folder", [])).toBe("other");
  });

  it("sorts roles correctly", () => {
    expect(roleSortOrder("inbox")).toBeLessThan(roleSortOrder("sent"));
    expect(roleSortOrder("sent")).toBeLessThan(roleSortOrder("trash"));
    expect(roleSortOrder("other")).toBeGreaterThan(roleSortOrder("trash"));
  });
});
