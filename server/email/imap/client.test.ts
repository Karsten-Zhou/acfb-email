import { describe, it, expect } from "vitest";
import { splitTopLevel, unquote, decodeMimeWord, parseAddressList, extractBalanced, parseHeaderText, parseAddressListBySemicolon } from "./client";

describe("IMAP raw-header parsing", () => {
  it("parses standard headers incl. folded continuation", () => {
    const raw = "From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>, c@example.com\r\nSubject: Hello\r\nDate: 2026-01-01\r\nMessage-ID: <x@y>\r\n";
    const h = parseHeaderText(raw);
    expect(h["from"]).toContain("alice@example.com");
    expect(h["subject"]).toBe("Hello");
    expect(h["date"]).toBe("2026-01-01");
    expect(h["message-id"]).toBe("<x@y>");
  });

  it("decodes encoded-word in subject", () => {
    const raw = "Subject: =?utf-8?B?SGVsbG8gV29ybGQ=?=\r\n";
    const h = parseHeaderText(raw);
    expect(h["subject"]).toBe("Hello World");
  });

  it("parses address header with names and bare addresses", () => {
    const addrs = parseAddressListBySemicolon('"Alice Example" <alice@example.com>, Bob <bob@other.org>, c@example.com');
    expect(addrs).toHaveLength(3);
    expect(addrs[0]).toEqual({ name: "Alice Example", address: "alice@example.com" });
    expect(addrs[1]).toEqual({ name: "Bob", address: "bob@other.org" });
    expect(addrs[2]).toEqual({ name: null, address: "c@example.com" });
  });
});

describe("IMAP ENVELOPE parsing helpers", () => {
  it("extracts balanced ENVELOPE content from the middle of a line", () => {
    // ENVELOPE is not at end-of-line: more fields follow before the final ).
    const line =
      '1 FETCH (UID 7 FLAGS (\\Seen) RFC822.SIZE 1234 INTERNALDATE "21-Feb-2026 09:30:00 +0000" ENVELOPE("Sat, 21 Feb 2026 09:30:00 +0000" "Hello" (("Alice" NIL "alice" "example.com")) NIL NIL (("Bob" NIL "bob" "other.org")) NIL NIL NIL "msg@id") BODY[HEADER.FIELDS (DATE)] "x")';
    const env = extractBalanced(line, "ENVELOPE(");
    expect(env).not.toBeNull();
    const parts = splitTopLevel(env as string);
    expect(parts).toHaveLength(10);
    expect(unquote(parts[1])).toBe("Hello");
    const from = parseAddressList(parts[2]);
    expect(from[0]?.address).toBe("alice@example.com");
  });

  it("splits top-level parenthesized tokens", () => {
    const s = '"date" "subject" NIL ("From Name" NIL "from" "example.com") NIL NIL NIL NIL NIL "msg@id"';
    const parts = splitTopLevel(s);
    expect(parts).toHaveLength(10);
    expect(parts[0]).toBe('"date"');
    expect(parts[2]).toBe("NIL");
    expect(parts[3]).toBe('("From Name" NIL "from" "example.com")');
  });

  it("unquotes strings and NIL", () => {
    expect(unquote('"Hello"')).toBe("Hello");
    expect(unquote("NIL")).toBeNull();
    expect(unquote("plain")).toBe("plain");
  });

  it("decodes MIME encoded-words", () => {
    expect(decodeMimeWord("=?utf-8?B?SGVsbG8gV29ybGQ=?=")).toBe("Hello World");
    expect(decodeMimeWord("plain subject")).toBe("plain subject");
  });

  it("parses an address list", () => {
    const input = '(("Alice Example" NIL "alice" "example.com") ("Bob" NIL "bob" "other.org"))';
    const res = parseAddressList(input);
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ name: "Alice Example", address: "alice@example.com" });
    expect(res[1]).toEqual({ name: "Bob", address: "bob@other.org" });
  });

  it("handles nil address list", () => {
    expect(parseAddressList("NIL")).toEqual([]);
  });

  it("decodes base64 display names with non-ascii", () => {
    const name = decodeMimeWord("=?utf-8?B?44Ko44Od44K544Kr44O844OJ?=");
    expect(name).toBe("エポスカード");
  });
});