import { describe, it, expect } from "vitest";
import {
  splitTopLevel,
  unquote,
  decodeMimeWord,
  parseAddressList,
  extractBalanced,
  parseHeaderText,
  parseAddressListBySemicolon,
  WireReader,
} from "./client";

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

/** Build a ReadableStream that enqueues raw byte chunks from an IMAP exchange. */
function streamFromChunks(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      }
      controller.close();
    },
  });
}

describe("WireReader (byte-accurate literal parsing)", () => {
  it("returns lines and literals in order for an ASCII literal", async () => {
    const body = new TextEncoder().encode("Subject: Hello\r\n\r\nBody");
    const reader = new WireReader(
      streamFromChunks([
        `* 1 FETCH (UID 42 BODY[] {${body.byteLength}}\r\n`,
        body,
        ")\r\nA1 OK FETCH completed\r\n",
      ]).getReader(),
    );
    const lines: string[] = [];
    let line: string | null;
    while ((line = await reader.readLine()) !== null) lines.push(line);
    const lits = reader.takeLiterals();
    expect(lines).toEqual(["* 1 FETCH (UID 42 BODY[] {22}", ")", "A1 OK FETCH completed"]);
    expect(lits.reduce((a, b) => a + b.byteLength, 0)).toBe(22);
    expect(new TextDecoder().decode(lits[0])).toBe("Subject: Hello\r\n\r\nBody");
  });

  it("handles a multi-byte (UTF-8) literal split across chunk boundaries", async () => {
    const body = new TextEncoder().encode("连接到 Microsoft 帐户的新应用 你好 world 中文内容");
    // Split mid multi-byte sequence to simulate real socket chunking.
    const a = body.slice(0, 17);
    const b = body.slice(17, 40);
    const c = body.slice(40);
    const reader = new WireReader(
      streamFromChunks([
        `* 5365 FETCH (UID 5365 BODY[] {${body.byteLength}}\r\n`,
        a,
        b,
        c,
        ")\r\nA1 OK FETCH completed\r\n",
      ]).getReader(),
    );
    const lines: string[] = [];
    let line: string | null;
    while ((line = await reader.readLine()) !== null) lines.push(line);
    const lits = reader.takeLiterals();
    expect(lines[lines.length - 1]).toBe("A1 OK FETCH completed");
    const gotLen = lits.reduce((x, y) => x + y.byteLength, 0);
    expect(gotLen).toBe(body.byteLength);
    expect(new TextDecoder().decode(lits[0])).toBe("连接到 Microsoft 帐户的新应用 你好 world 中文内容");
  });

  it("returns null when the stream ends without data", async () => {
    const reader = new WireReader(streamFromChunks([]).getReader());
    expect(await reader.readLine()).toBeNull();
  });
});