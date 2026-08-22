// A compact IMAP4rev1 client built on the Workers TCP sockets API
// (cloudflare:sockets). No Node net/tls dependency, so it runs in Workers.
//
// Scope: list/select/fetch/search/flags/copy/move/delete — enough to support
// a real mailbox with UID-based incremental sync.
//
// References: RFC 3501 (IMAP4rev1), RFC 6851 (MOVE), RFC 4315 (UIDPLUS).

import { connect } from "cloudflare:sockets";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean; // implicit TLS (993) vs STARTTLS upgrade
  username: string;
  password: string;
}

export interface MailboxInfo {
  name: string;
  delimiter: string | null;
  flags: string[];
}

export interface SelectResult {
  total: number;
  unseen: number;
  uidValidity: number;
}

export interface Envelope {
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: { name: string | null; address: string | null } | null;
  to: { name: string | null; address: string | null }[];
  cc: { name: string | null; address: string | null }[];
  date: string | null; // server-provided Date
  flags: string[];
  size: number | null;
  internalDate: string | null;
}

export class ImapError extends Error {
  constructor(
    message: string,
    readonly imapCode?: string,
  ) {
    super(message);
    this.name = "ImapError";
  }
}

interface Response {
  ok: boolean;
  lines: string[];
  literals: Uint8Array[];
  code: string | null; // response code like UIDVALIDITY
}

/**
 * A low-level reader that handles CRLF lines AND {n} literals, so that
 * FETCH BODY[...] responses with literal payloads can be captured.
 *
 * IMPORTANT: all counting happens on RAW BYTES. Literal sizes (`{n}`) are
 * byte counts, but `TextDecoder`→string length is UTF-16 code units, so a
 * multi-byte (UTF-8/GBK…) literal would desync the reader and hang on the
 * tagged completion line. We therefore keep a byte buffer and only decode
 * line data back to text.
 */
export class WireReader {
  /** Pending raw bytes not yet consumed by a line or literal. */
  private bytes = new Uint8Array(0);
  /** Bytes still owed by an announced but not-yet-read literal. */
  private need = 0;
  private literalBytes: Uint8Array[] = [];

  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Append raw socket bytes to the internal buffer. */
  private async fill(): Promise<boolean> {
    const { value, done } = await this.reader.read();
    if (done) return false;
    if (value && value.byteLength > 0) {
      const next = new Uint8Array(this.bytes.byteLength + value.byteLength);
      next.set(this.bytes, 0);
      next.set(value, this.bytes.byteLength);
      this.bytes = next;
    }
    return true;
  }

  /** Find CRLF in the raw buffer; -1 if not present yet. */
  private findCrlf(from = 0): number {
    for (let i = from; i + 1 < this.bytes.length; i++) {
      if (this.bytes[i] === 13 && this.bytes[i + 1] === 10) return i;
    }
    return -1;
  }

  /**
   * Read one logical line, absorbing embedded literals into `literals`.
   * Lines are returned as decoded ASCII/UTF-8 text; literals stay raw bytes.
   */
  async readLine(): Promise<string | null> {
    while (true) {
      if (this.need > 0) {
        // Consume exactly `need` bytes (may span multiple socket chunks).
        while (this.bytes.byteLength < this.need && (await this.fill())) {
          /* loop */
        }
        const take = Math.min(this.need, this.bytes.byteLength);
        const literal = new Uint8Array(take);
        literal.set(this.bytes.subarray(0, take));
        this.bytes = this.bytes.subarray(take);
        this.need -= take;
        this.literalBytes.push(literal);
        if (this.need > 0) return null; // stream ended mid-literal (rare)
        continue;
      }

      // Look for a complete line in the raw buffer.
      let idx = this.findCrlf();
      // If no CRLF yet but we have data that could be the tail (e.g. a
      // literal-less line ending without newline), wait for more data.
      while (idx < 0) {
        if (!(await this.fill())) break;
        idx = this.findCrlf();
      }
      if (idx >= 0) {
        const raw = this.bytes.subarray(0, idx);
        const line = new TextDecoder().decode(raw);
        this.bytes = this.bytes.subarray(idx + 2);
        // If this line announces a literal, remember it.
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) {
          this.need = parseInt(lit[1], 10);
        }
        return line;
      }
      // No CRLF and source ended.
      if (this.bytes.byteLength === 0) return null;
      const tail = new TextDecoder().decode(this.bytes);
      this.bytes = new Uint8Array(0);
      return tail.length > 0 ? tail : null;
    }
  }

  takeLiterals(): Uint8Array[] {
    const out = this.literalBytes;
    this.literalBytes = [];
    return out;
  }
}

export class ImapClient {
  private socket: ReturnType<typeof connect> | null = null;
  private wire: WireReader | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private tagCounter = 0;
  private cfg: ImapConfig;

  constructor(cfg: ImapConfig) {
    this.cfg = cfg;
  }

  async connect(): Promise<void> {
    const { host, port, secure } = this.cfg;
    let s = connect(
      { hostname: host, port },
      { secureTransport: secure ? "on" : "starttls", allowHalfOpen: true },
    );
    await s.opened;
    if (!secure) {
      s = s.startTls();
      await s.opened;
    }
    this.socket = s;
    this.wire = new WireReader(s.readable.getReader());
    this.writer = s.writable.getWriter();

    const greeting = await this.wire.readLine();
    if (!greeting || !greeting.startsWith("* OK")) {
      throw new ImapError("Unexpected server greeting");
    }
    await this.command("LOGIN", `"${this.cfg.username}" "${this.cfg.password}"`);
  }

  private async write(cmd: string): Promise<void> {
    if (!this.writer) throw new ImapError("Not connected");
    await this.writer.write(new TextEncoder().encode(cmd + "\r\n"));
  }

  async command(cmd: string, args = ""): Promise<Response> {
    if (!this.wire || !this.writer) throw new ImapError("Not connected");
    const tag = `A${++this.tagCounter}`;
    const full = `${tag} ${cmd}${args ? " " + args : ""}`;
    await this.write(full);

    const lines: string[] = [];

    while (true) {
      const line = await this.wire.readLine();
      if (line === null) throw new ImapError("Connection closed during command");
      if (!line.startsWith(tag + " ")) {
        lines.push(line);
        continue;
      }
      const rest = line.slice(tag.length + 1);
      const status: "ok" | "no" | "bad" = rest.startsWith("OK")
        ? "ok"
        : rest.startsWith("NO")
          ? "no"
          : "bad";
      const m = /\[([^\]]+)\]/.exec(rest);
      const code = m ? m[1] : null;
      const literals = this.wire.takeLiterals();
      if (status !== "ok") {
        const untagged = lines[lines.length - 1] ?? "";
        // The tagged response (rest) holds the human-readable reason, e.g.
        // "NO [AUTHENTICATIONFAILED] Invalid credentials." — use it.
        const reason = (untagged + " " + rest).trim();
        throw new ImapError(`IMAP ${cmd} refused: ${reason}`, status);
      }
      return { ok: true, lines, literals, code };
    }
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      /* ignore */
    }
    await this.close();
  }

  async close(): Promise<void> {
    try {
      await this.writer?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.wire = null;
    this.writer = null;
  }

  async listMailboxes(): Promise<MailboxInfo[]> {
    const res = await this.command("LIST", '"" "*"');
    const out: MailboxInfo[] = [];
    const sub = await this.command("LSUB", '"" "*"');
    const subNames = new Set<string>();
    for (const line of sub.lines) {
      const m = /^\* LSUB \(([^)]*)\) "?([^"]*)"? (.+)$/.exec(line);
      if (m) subNames.add(m[3].replace(/^"|"$/g, ""));
    }
    for (const line of res.lines) {
      if (!line.startsWith("* LIST")) continue;
      const m =
        /^\* LIST \(([^)]*)\) "(.*)" (.+)$/.exec(line) ||
        /^\* LIST \(([^)]*)\) NIL (.+)$/.exec(line);
      if (!m) continue;
      const flags = m[1].split(" ").filter(Boolean);
      const delimiterRaw = m[2] ?? null;
      const delimiter = delimiterRaw === null || delimiterRaw === "" ? null : delimiterRaw;
      let name = m[m.length - 1].trim();
      if (name.startsWith('"') && name.endsWith('"')) {
        name = name.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      if (name === "") continue;
      out.push({ name, delimiter, flags });
    }
    return out;
  }

  async select(mailbox: string): Promise<SelectResult> {
    const res = await this.command("SELECT", `"${mailbox}"`);
    let total = 0,
      unseen = 0,
      uidValidity = 0;
    for (const line of res.lines) {
      const t = /^\* (\d+) EXISTS/.exec(line);
      if (t) total = parseInt(t[1], 10);
      const u = /^\* OK \[UNSEEN (\d+)\]/.exec(line);
      if (u) unseen = parseInt(u[1], 10);
      const uv = /^\* OK \[UIDVALIDITY (\d+)\]/.exec(line);
      if (uv) uidValidity = parseInt(uv[1], 10);
    }
    if (res.code?.startsWith("UIDVALIDITY")) {
      const uv = /UIDVALIDITY (\d+)/.exec(res.code);
      if (uv) uidValidity = parseInt(uv[1], 10);
    }
    return { total, unseen, uidValidity };
  }

  /** Fetch envelopes for a set of UIDs (batched to avoid huge lines). */
  async fetchEnvelopes(uids: number[]): Promise<Envelope[]> {
    const out: Envelope[] = [];
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      const res = await this.command(
        "UID FETCH",
        `${chunk.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE)`,
      );
      for (const line of res.lines) {
        if (!line.startsWith("* ")) continue;
        const m = /^\* \d+ FETCH \((.+)\)$/.exec(line);
        if (!m) continue;
        const env = this.parseEnvelopeLine(m[1]);
        if (env) out.push(env);
      }
    }
    return out;
  }

  /**
   * Fetch only the raw header block (as a literal) for a set of UIDs, and
   * parse FROM/SUBJECT/DATE/MESSAGE-ID from it. This is more robust than the
   * ENVELOPE parser for providers that return non-standard ENVELOPE data.
   */
  async fetchHeadersByUid(uids: number[]): Promise<Envelope[]> {
    const out: Envelope[] = [];
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      const res = await this.command(
        "UID FETCH",
        `${chunk.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])`,
      );
      // res.literals holds the header bodies in order; associate with UIDs by
      // matching the preceding FETCH line.
      let litIdx = 0;
      for (let li = 0; li < res.lines.length; li++) {
        const line = res.lines[li];
        if (!line.startsWith("* ")) continue;
        const m = /^\* \d+ FETCH \(([^)]*UID[^)]*)\)/.exec(line);
        if (!m) continue;
        const uidM = /\bUID (\d+)/.exec(line);
        if (!uidM) continue;
        const uid = parseInt(uidM[1], 10);
        const body = res.literals[litIdx++] ?? new Uint8Array();
        out.push(this.parseHeaderLiteral(uid, line, body));
      }
    }
    return out;
  }

  private parseHeaderLiteral(uid: number, line: string, body: Uint8Array): Envelope {
    const flagsM = /FLAGS \(([^)]*)\)/.exec(line);
    const flags = flagsM ? flagsM[1].split(" ").filter(Boolean) : [];
    const sizeM = /RFC822\.SIZE (\d+)/.exec(line);
    const size = sizeM ? parseInt(sizeM[1], 10) : null;
    const internalM = /INTERNALDATE "([^"]*)"/.exec(line);
    const internalDate = internalM ? internalM[1] : null;
    const headerText = new TextDecoder().decode(body);
    const headers = parseHeaderText(headerText);
    return {
      uid,
      messageId: headers["message-id"] ?? null,
      subject: headers["subject"] ?? null,
      from: parseAddressListBySemicolon(headers["from"])[0] ?? null,
      to: parseAddressListBySemicolon(headers["to"]),
      cc: parseAddressListBySemicolon(headers["cc"]),
      date: headers["date"] ?? null,
      flags,
      size,
      internalDate,
    };
  }

  private parseEnvelopeLine(body: string): Envelope | null {
    const uidM = /\bUID (\d+)/.exec(body);
    if (!uidM) return null;
    const uid = parseInt(uidM[1], 10);
    const flagsM = /FLAGS \(([^)]*)\)/.exec(body);
    const flags = flagsM ? flagsM[1].split(" ").filter(Boolean) : [];
    const sizeM = /RFC822\.SIZE (\d+)/.exec(body);
    const size = sizeM ? parseInt(sizeM[1], 10) : null;
    const internalM = /INTERNALDATE "([^"]*)"/.exec(body);
    const internalDate = internalM ? internalM[1] : null;

    const env = this.extractEnvelope(body);
    return {
      uid,
      messageId: env?.messageId ?? null,
      subject: env?.subject ?? null,
      from: env?.from ?? null,
      to: env?.to ?? [],
      cc: env?.cc ?? [],
      date: env?.date ?? null,
      flags,
      size,
      internalDate,
    };
  }

  /** Extract the ENVELOPE(...) parenthesized structure. */
  private extractEnvelope(body: string): {
    date: string | null;
    subject: string | null;
    from: { name: string | null; address: string | null } | null;
    to: { name: string | null; address: string | null }[];
    cc: { name: string | null; address: string | null }[];
    messageId: string | null;
  } | null {
    const envBody = extractBalanced(body, "ENVELOPE(");
    if (envBody === null) return null;
    const parts = splitTopLevel(envBody);
    // env: (date subject from sender reply-to to cc bcc in-reply-to message-id)
    if (parts.length < 10) return null;
    const date = unquote(parts[0]);
    const subject = decodeMimeWord(unquote(parts[1]));
    const from = parseAddressList(parts[2]);
    const to = parseAddressList(parts[5]);
    const cc = parseAddressList(parts[6]);
    const messageId = unquote(parts[9]);
    return { date, subject, from: from[0] ?? null, to, cc, messageId };
  }

  /** Search all UIDs in the currently selected mailbox. */
  async searchAllUids(): Promise<number[]> {
    const res = await this.command("UID SEARCH", "ALL");
    const line = res.lines.find((l) => l.startsWith("* SEARCH"));
    if (!line) return [];
    return line.slice("* SEARCH ".length).trim().split(/\s+/).filter(Boolean).map(Number);
  }

  /** Search UIDs newer than a given UID (excluding already known ones). */
  async searchUidsSince(lastUid: number): Promise<number[]> {
    const res = await this.command("UID SEARCH", `UID ${lastUid}:*`);
    const line = res.lines.find((l) => l.startsWith("* SEARCH"));
    if (!line) return [];
    return line
      .slice("* SEARCH ".length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => n > lastUid);
  }

  /** Search UIDs older than a given UID (page before `beforeUid`). */
  async searchUidsBefore(beforeUid: number): Promise<number[]> {
    const res = await this.command("UID SEARCH", `UID 1:${Math.max(beforeUid - 1, 1)}`);
    const line = res.lines.find((l) => l.startsWith("* SEARCH"));
    if (!line) return [];
    return line.slice("* SEARCH ".length).trim().split(/\s+/).filter(Boolean).map(Number);
  }

  /** Fetch the full raw message bytes for a UID (literal). */
  async fetchRawByUid(uid: number): Promise<Uint8Array> {
    const res = await this.command("UID FETCH", `${uid} (BODY.PEEK[])`);
    // The literal for the body is the last literal captured; there should be one.
    const lit = res.literals[res.literals.length - 1];
    if (!lit) {
      // Some servers return it inline; try to reconstruct from lines.
      throw new ImapError("No literal returned for message body");
    }
    return lit;
  }

  /** Copy messages by UID to another mailbox. */
  async copy(uids: number[], target: string): Promise<void> {
    await this.command("UID COPY", `${uids.join(",")} "${target}"`);
  }

  /** Move messages by UID (MOVE extension) with COPY+EXPUNGE fallback at sync layer. */
  async move(uids: number[], target: string): Promise<void> {
    try {
      await this.command("UID MOVE", `${uids.join(",")} "${target}"`);
    } catch (err) {
      if (err instanceof ImapError && err.imapCode !== "bad") {
        // Fallback: copy then mark expunged — but let caller handle via copy.
        throw err;
      }
      throw err;
    }
  }

  /** Set flags on a set of UIDs. */
  async setFlags(uids: number[], flags: { read?: boolean; starred?: boolean }): Promise<void> {
    if (uids.length === 0) return;
    const setParts: string[] = [];
    if (flags.read === true) setParts.push("\\Seen");
    if (flags.starred === true) setParts.push("\\Flagged");
    if (setParts.length) {
      await this.command("UID STORE", `${uids.join(",")} +FLAGS.SILENT (${setParts.join(" ")})`);
    }
    const clearParts: string[] = [];
    if (flags.read === false) clearParts.push("\\Seen");
    if (flags.starred === false) clearParts.push("\\Flagged");
    if (clearParts.length) {
      await this.command("UID STORE", `${uids.join(",")} -FLAGS.SILENT (${clearParts.join(" ")})`);
    }
  }

  /** Mark a set of UIDs as deleted and expunge. */
  async delete(uids: number[]): Promise<void> {
    await this.command("UID STORE", `${uids.join(",")} +FLAGS (\\Deleted)`);
    await this.command("EXPUNGE");
  }
}

// ---------------------------------------------------------------
// Small helpers for IMAP structured parsing.
// ---------------------------------------------------------------

/** Split a string of IMAP parenthesized/space-separated args at top level. */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    if ((ch === " " || ch === "\t") && depth === 0 && !inQuote) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Given `text` containing `prefix` (e.g. "ENVELOPE("), return the substring
 * inside the matching balanced parentheses, or null if not found/mismatched.
 * Respects quoted strings (spaces and parens inside quotes are not structural).
 */
export function extractBalanced(text: string, prefix: string): string | null {
  const start = text.indexOf(prefix);
  if (start < 0) return null;
  let depth = 0;
  let inQuote = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== "\\") inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return text.slice(start + prefix.length, i);
      }
    }
  }
  return null;
}

export function unquote(s: string): string | null {
  s = s.trim();
  if (s === "NIL") return null;
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}

export function decodeMimeWord(s: string | null): string | null {
  if (s === null) return null;
  return s.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_m: string, _cs: string, enc: string, data: string) => {
      try {
        if (enc.toLowerCase() === "b") {
          const bin = atob(data);
          return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
        }
        return data
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_x: string, h: string) =>
            String.fromCharCode(parseInt(h, 16)),
          );
      } catch {
        return data;
      }
    },
  );
}

export function parseAddressList(
  s: string | null,
): { name: string | null; address: string | null }[] {
  if (!s || s.trim() === "NIL") return [];
  const inner = s.trim();
  if (!inner.startsWith("(") || !inner.endsWith(")")) return [];
  const body = inner.slice(1, -1);
  const addrs = splitTopLevel(body);
  const out: { name: string | null; address: string | null }[] = [];
  for (const a of addrs) {
    if (a.trim() === "NIL") continue;
    // Each address: ("name" NIL "mailbox" "host")
    if (!a.startsWith("(") || !a.endsWith(")")) continue;
    const innerA = a.slice(1, -1);
    const parts = splitTopLevel(innerA);
    if (parts.length < 4) continue;
    const name = decodeMimeWord(unquote(parts[0]));
    const mailbox = unquote(parts[2]);
    const host = unquote(parts[3]);
    let address: string | null = null;
    if (mailbox && host) address = `${mailbox}@${host}`;
    else if (mailbox) address = mailbox;
    out.push({ name, address });
  }
  return out;
}

/**
 * Parse a raw RFC5322 header block (already unfolded/decoded where possible)
 * into a map of lowercased header name -> value (first occurrence wins).
 */
export function parseHeaderText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Handle CRLF or LF line endings; a header may span folded continuation lines.
  const lines = raw.split(/\r?\n/);
  let currentKey: string | null = null;
  for (const line of lines) {
    if (/^[\t ]/.test(line) && currentKey) {
      // Folded continuation
      out[currentKey] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    currentKey = key;
    if (out[key] === undefined) out[key] = decodeWords1(val);
  }
  return out;
}

/** Decode MIME encoded-words + strip surrounding whitespace. */
function decodeWords1(val: string): string {
  const decoded = decodeMimeWord(val) ?? "";
  return decoded.trim();
}

/**
 * Parse a raw address header (From/To/Cc) into structured addresses.
 * Handles comma-separated "Name <addr>" / bare addresses / encoded names.
 */
export function parseAddressListBySemicolon(s: string | null | undefined): {
  name: string | null;
  address: string | null;
}[] {
  if (!s) return [];
  const out: { name: string | null; address: string | null }[] = [];
  // Split on commas at top level (not inside quotes or <>).
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  let angle = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "<") angle++;
      else if (ch === ">") angle--;
      if (ch === "," && angle === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);

  for (const raw of parts) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const angleM = /<([^>]+)>/.exec(trimmed);
    const hasAngle = angleM !== null;
    const address = hasAngle ? angleM![1].trim() : trimmed;
    const name = hasAngle
      ? decodeWords1(trimmed.slice(0, angleM!.index).trim().replace(/^"|"$/g, "")) || null
      : null;
    if (address) out.push({ name, address });
  }
  return out;
}
