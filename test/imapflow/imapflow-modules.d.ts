// Ambient types for the imapflow internals exercised by the workerd-runtime
// port of upstream's `test/imap-stream-test.js`. imapflow only ships a .d.ts
// for its public entry (`lib/imap-flow.d.ts`), so these deep imports have no
// bundled types. Declaring them here (as module augmentations) keeps the test
// file typechecked without weakening the project's `no-any` bar.
//
// The runtime objects are Node Buffers (subclasses of Uint8Array); the Cloudflare
// vitest plugin types model `Buffer` as `Uint8Array`, so we type the payloads as
// Uint8Array and let the test read bytes/TextDecoder rather than Buffer methods.

declare module "imapflow/lib/handler/imap-stream" {
  export interface ImapStreamCommand {
    /** Raw line(s) of the command/response, literal markers included. */
    payload: Uint8Array;
    /** Literal blocks extracted from the stream, in order. */
    literals: Uint8Array[];
    /** Resolves the stream's push backpressure; must be called after read(). */
    next: () => void;
    /** Whether more buffered input followed this command on the wire. */
    trailingAfterLine: boolean;
  }

  /** Terminal parser failures carry a `code` plus size diagnostics. */
  export interface ImapStreamError extends Error {
    code?: string;
    responseSize?: number;
    maxSize?: number;
    literalSize?: number;
  }

  export interface ImapStreamLogger {
    trace(data: Record<string, unknown>): void;
    debug(data: Record<string, unknown>): void;
    info(data: Record<string, unknown>): void;
    warn(data: Record<string, unknown>): void;
    error(data: Record<string, unknown>): void;
  }

  export class ImapStream {
    constructor(options?: Record<string, unknown>);
    maxLineLength: number;
    maxLiteralSize: number;
    maxResponseSize: number;
    literalWaiting: number;
    lineBytes: number;
    destroyed: boolean;
    log: ImapStreamLogger;
    inputQueue: Array<{ chunk: Uint8Array; next: () => void }>;

    on(event: "readable" | "end", listener: () => void): this;
    on(event: "data", listener: (cmd: ImapStreamCommand) => void): this;
    on(event: "error", listener: (err: ImapStreamError) => void): this;
    once(event: "drain" | "end", listener: () => void): this;
    once(event: "error", listener: (err: ImapStreamError) => void): this;
    read(): ImapStreamCommand | null;
    write(chunk: Uint8Array | string): boolean;
    end(chunk?: Uint8Array | string): void;
    destroy(err?: Error): void;
    resume(): this;
    checkLiteralMarker(line: Uint8Array | null): boolean;
  }
}

declare module "imapflow/lib/handler/imap-handler" {
  export interface ParsedCommand {
    tag: string;
    command: string;
    attributes: Array<[string, unknown]>;
  }
  export function parser(
    command: Uint8Array,
    options?: { literals?: Uint8Array[] },
  ): Promise<ParsedCommand>;
}
