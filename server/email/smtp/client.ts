// A compact SMTP client built on the Workers TCP sockets API.
// Supports implicit TLS (465) and STARTTLS (587) submission, plus
// AUTH LOGIN/PLAIN and AUTH XOAUTH2 (OAuth2 for Gmail/Outlook).

import { connect } from "cloudflare:sockets";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465), false = STARTTLS (587)
  username: string;
  /** Password login (AUTH LOGIN) — omitted when using OAuth2. */
  password?: string;
  /** OAuth2 access token (AUTH XOAUTH2) — used by Gmail/Outlook. */
  accessToken?: string;
  from: string;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

class SmtpClientCore {
  private socket: ReturnType<typeof connect> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  private cfg: SmtpConfig;

  constructor(cfg: SmtpConfig) {
    this.cfg = cfg;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        return line;
      }
      const { value, done } = await this.reader!.read();
      if (done) throw new SmtpError("Connection closed by server");
      this.buffer += new TextDecoder().decode(value);
    }
  }

  /**
   * Read a (possibly multi-line) SMTP reply. Returns the 3-digit code and the
   * full text (joined with newlines). A reply is complete when a line starts
   * with "<code> " (space) rather than "<code>-".
   */
  private async readReply(expectedCode?: number): Promise<{ code: number; text: string }> {
    let fullText = "";
    let code = 0;
    while (true) {
      const line = await this.readLine();
      if (line.length < 3) throw new SmtpError("Malformed SMTP reply");
      const parsed = parseInt(line.slice(0, 3), 10);
      if (code === 0) code = parsed; // first line's code is authoritative
      fullText += (fullText ? "\n" : "") + line.slice(4);
      if (line.length === 3 || line[3] === " ") {
        break;
      }
    }
    if (expectedCode !== undefined && code !== expectedCode) {
      throw new SmtpError(`SMTP ${expectedCode} expected, got ${code}: ${fullText}`, code);
    }
    return { code, text: fullText };
  }

  private async send(line: string): Promise<void> {
    if (!this.writer) throw new SmtpError("Not connected");
    await this.writer.write(new TextEncoder().encode(line + "\r\n"));
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
    this.reader = s.readable.getReader();
    this.writer = s.writable.getWriter();
    const greet = await this.readReply(220);
    void greet;
  }

  async ehlo(): Promise<void> {
    // Try EHLO with our hostname; if it fails, some servers only accept HELO.
    try {
      await this.send("EHLO mail.cloudflare.email");
      await this.readReply(250);
    } catch {
      await this.send("HELO mail.cloudflare.email");
      await this.readReply(250);
    }
  }

  async startTls(): Promise<void> {
    await this.send("STARTTLS");
    await this.readReply(220);
    if (!this.socket) throw new SmtpError("No socket");
    // Upgrade our reader/writer to the TLS socket.
    const upgraded = this.socket.startTls();
    await upgraded.opened;
    this.socket = upgraded;
    this.reader = upgraded.readable.getReader();
    this.writer = upgraded.writable.getWriter();
    this.buffer = "";
    await this.ehlo();
  }

  async auth(): Promise<void> {
    if (this.cfg.accessToken) {
      // XOAUTH2 initial response: user=<email>\x01auth=Bearer <token>\x01\x01.
      const payload = `user=${this.cfg.username}\u0001auth=Bearer ${this.cfg.accessToken}\u0001\u0001`;
      await this.send(`AUTH XOAUTH2 ${btoa(payload)}`);
      await this.readReply(235);
      return;
    }
    await this.send("AUTH LOGIN");
    await this.readReply(334);
    await this.send(btoa(this.cfg.username));
    await this.readReply(334);
    await this.send(btoa(this.cfg.password ?? ""));
    await this.readReply(235);
  }

  async mailFrom(from: string): Promise<void> {
    await this.send(`MAIL FROM:<${from}>`);
    await this.readReply(250);
  }

  async rcptTo(to: string): Promise<void> {
    await this.send(`RCPT TO:<${to}>`);
    const r = await this.readReply();
    if (r.code !== 250 && r.code !== 251) {
      throw new SmtpError(`Recipient rejected: ${r.text}`, r.code);
    }
  }

  async data(raw: Uint8Array): Promise<void> {
    await this.send("DATA");
    await this.readReply(354);
    // Dot-stuff: lines starting with "." get an extra "." prepended.
    const text = new TextDecoder().decode(raw);
    const stuffed = text
      .split("\r\n")
      .map((l) => (l.startsWith(".") ? "." + l : l))
      .join("\r\n");
    // Ensure trailing CRLF then terminator.
    await this.send(stuffed + (stuffed.endsWith("\r\n") ? "" : "\r\n") + ".");
    await this.readReply(250);
  }

  async quit(): Promise<void> {
    try {
      await this.send("QUIT");
      await this.readReply(221);
    } catch {
      /* ignore */
    }
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
  }
}

/**
 * Send a pre-built RFC822 message (raw bytes) to a list of recipients.
 */
export async function smtpSend(
  cfg: SmtpConfig,
  rawMessage: Uint8Array,
  recipients: string[],
): Promise<void> {
  const client = new SmtpClientCore(cfg);
  try {
    await client.connect();
    await client.ehlo();
    if (cfg.port === 587 && !cfg.secure) {
      // STARTTLS on 587
      await client.startTls();
    }
    await client.auth();
    await client.mailFrom(cfg.from);
    for (const r of recipients) {
      await client.rcptTo(r);
    }
    await client.data(rawMessage);
  } finally {
    await client.quit();
  }
}
