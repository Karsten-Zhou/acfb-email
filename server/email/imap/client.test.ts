import { describe, it, expect } from "vitest";
import { splitTopLevel, unquote, decodeMimeWord, parseAddressList } from "./client";

describe("IMAP ENVELOPE parsing helpers", () => {
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