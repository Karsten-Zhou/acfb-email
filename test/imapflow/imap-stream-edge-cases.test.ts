// Port of imapflow's `test/imap-stream-edge-cases-test.js` run under the Cloudflare
// Workers runtime (via @cloudflare/vitest-plugin). It exercises the patched
// `ImapStream` (`lib/handler/imap-stream.js`) — including the `_startProcessInput`
// single-flight drain — plus its size-cap edge cases, under workerd stream-timing.
// Upstream uses nodeunit + `test.done()`; here we drive the stream with promises.
//
// Runtime values are Node Buffers; the plugin's types model `Buffer` as
// `Uint8Array`, which is sufficient for the assertions below (the global `Buffer`
// is `any` in this tsconfig, so Buffer helpers still typecheck).
import { it, expect } from "vitest";
import {
  ImapStream,
  type ImapStreamCommand,
  type ImapStreamError,
} from "imapflow/lib/handler/imap-stream";

/**
 * Runs a stream test: writes via `writer`, drives the readable side, and resolves
 * once the stream ends. `onCommand` is called for each parsed command. Mirrors the
 * upstream `runStreamTest` helper (pending-read reentrancy guard included, since
 * the reader awaits nothing and must not drop an 'end' between iterations).
 */
function runStreamTest(
  onCommand: (cmd: ImapStreamCommand) => void,
  writer: (stream: ImapStream) => Promise<void>,
  expectedCount?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = new ImapStream({ cid: "test" });
    let commandCount = 0;

    let reading = false;
    let pendingRead = false;

    const reader = async () => {
      let cmd: ImapStreamCommand | null;
      while ((cmd = stream.read()) !== null) {
        commandCount++;
        onCommand(cmd);
        cmd.next();
      }
    };

    const drainStream = () => {
      if (reading) {
        pendingRead = true;
        return;
      }
      reading = true;
      reader()
        .catch(reject)
        .finally(() => {
          reading = false;
          if (pendingRead) {
            pendingRead = false;
            drainStream();
          }
        });
    };

    stream.on("readable", drainStream);
    stream.on("error", reject);
    stream.on("end", () => {
      if (expectedCount !== undefined) {
        expect(commandCount).toBe(expectedCount);
      }
      resolve();
    });

    writer(stream).catch(reject);
  });
}

/** Resolves when the stream ends cleanly (null) or fails (the error). */
function settle(stream: ImapStream): Promise<ImapStreamError | null> {
  return new Promise((resolve) => {
    stream.once("error", resolve);
    stream.once("end", () => resolve(null));
  });
}

/** Resolves with the first error the stream emits. */
function awaitError(stream: ImapStream): Promise<ImapStreamError> {
  return new Promise((resolve) => stream.on("error", resolve));
}

it("Literal split across chunks", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A APPEND {5}\r\n");
      expect(cmd.literals.length).toBe(1);
      expect(Buffer.isBuffer(cmd.literals[0])).toBe(true);
      expect(cmd.literals[0].toString()).toBe("12345");
    },
    async (stream) => {
      stream.write(Buffer.from("A APPEND {5}\r\n"));
      stream.end(Buffer.from("12345\r\n"));
    },
    1,
  );
});

it("Literal with zero size", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A APPEND {0}\r\n");
      expect(cmd.literals.length).toBe(1);
      expect(Buffer.isBuffer(cmd.literals[0])).toBe(true);
      expect(cmd.literals[0].length).toBe(0);
    },
    async (stream) => {
      stream.end(Buffer.from("A APPEND {0}\r\n\r\n"));
    },
    1,
  );
});

it("Multiple commands in single chunk", async () => {
  const expected = ["A CMD1", "B CMD2"];
  let index = 0;
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe(expected[index]);
      index++;
    },
    async (stream) => {
      stream.end(Buffer.from("A CMD1\r\nB CMD2\r\n"));
    },
    2,
  );
});

it("LiteralTooLarge error", async () => {
  const stream = new ImapStream({ cid: "test" });
  const err = awaitError(stream);
  stream.write(Buffer.from("A APPEND {1073741825}\r\n"));
  expect((await err).code).toBe("LiteralTooLarge");
});

it("LiteralTooLarge error honors configured maxLiteralSize", async () => {
  const cap = 1024;
  const stream = new ImapStream({ cid: "test", maxLiteralSize: cap });
  const err = awaitError(stream);
  stream.write(Buffer.from("A APPEND {2048}\r\n"));
  const e = await err;
  expect(e.code).toBe("LiteralTooLarge");
  expect(e.maxSize).toBe(cap);
  expect(e.literalSize).toBe(2048);
});

it("maxLiteralSize: 0 is honored (not swallowed into the default)", async () => {
  const stream = new ImapStream({ cid: "test", maxLiteralSize: 0 });
  expect(stream.maxLiteralSize).toBe(0);
  const err = awaitError(stream);
  stream.write(Buffer.from("A APPEND {1}\r\n"));
  expect((await err).code).toBe("LiteralTooLarge");
});

it("Literal within configured maxLiteralSize parses cleanly", async () => {
  const stream = new ImapStream({ cid: "test", maxLiteralSize: 1024 });
  const literal = Buffer.alloc(512, 0x61);
  const results: Array<Pick<ImapStreamCommand, "literals">> = [];

  const done = new Promise<void>((resolve, reject) => {
    stream.on("readable", () => {
      let cmd: ImapStreamCommand | null;
      while ((cmd = stream.read()) !== null) {
        results.push(cmd);
        cmd.next();
      }
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  stream.write(Buffer.from("A APPEND {512}\r\n"));
  stream.write(literal);
  stream.end(Buffer.from("\r\n"));

  await done;
  expect(results.length).toBe(1);
  expect(results[0].literals.length).toBe(1);
  expect(results[0].literals[0].length).toBe(512);
});

it("Incomplete line continued in next chunk", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A CAPABILITY");
      expect(cmd.literals.length).toBe(0);
    },
    async (stream) => {
      stream.write(Buffer.from("A CA"));
      stream.end(Buffer.from("PABILITY\r\n"));
    },
    1,
  );
});

it("Empty chunk then valid command", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A CMD");
      expect(cmd.literals.length).toBe(0);
    },
    async (stream) => {
      stream.write(Buffer.alloc(0));
      stream.end(Buffer.from("A CMD\r\n"));
    },
    1,
  );
});

it("String input converted to Buffer", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A CMD");
      expect(Buffer.isBuffer(cmd.payload)).toBe(true);
      expect(cmd.literals.length).toBe(0);
    },
    async (stream) => {
      stream.end("A CMD\r\n");
    },
    1,
  );
});

it("LF-only line terminator", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString()).toBe("A CMD");
      expect(cmd.literals.length).toBe(0);
    },
    async (stream) => {
      stream.end(Buffer.from("A CMD\n"));
    },
    1,
  );
});

it("Many chunks trigger event loop yield", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.payload.toString().startsWith("A")).toBe(true);
    },
    async (stream) => {
      for (let i = 0; i < 15; i++) {
        stream.write(Buffer.from(`A CMD${i}\r\n`));
      }
      stream.end();
    },
    15,
  );
});

it("Destroy with queued items does not hang", async () => {
  const stream = new ImapStream({ cid: "test" });
  let errorEmitted = false;
  stream.on("error", () => {
    errorEmitted = true;
  });

  stream.write(Buffer.from("A CMD1\r\n"));
  stream.write(Buffer.from("B CMD2\r\n"));
  stream.destroy();

  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  expect(errorEmitted).toBe(false);
});

it("logRaw option triggers trace logging", async () => {
  let traceCalled = false;
  const trace: { data: Record<string, unknown> | null } = { data: null };

  const stream = new ImapStream({ cid: "test", logRaw: true });
  stream.log = {
    trace: (data) => {
      traceCalled = true;
      trace.data = data;
    },
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const done = new Promise<void>((resolve, reject) => {
    stream.on("readable", () => {
      let cmd: ImapStreamCommand | null;
      while ((cmd = stream.read()) !== null) {
        cmd.next();
      }
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  stream.end(Buffer.from("A CMD\r\n"));
  await done;

  expect(traceCalled).toBe(true);
  expect(trace.data).toBeTruthy();
  expect(trace.data?.src).toBe("s");
  expect(trace.data?.data).toBeTruthy();
});

it("Adjacent literals with marker at line start", async () => {
  await runStreamTest(
    (cmd) => {
      expect(cmd.literals.length).toBe(2);
      expect(cmd.literals[0].toString()).toBe("12345");
      expect(cmd.literals[1].toString()).toBe("ABC");
    },
    async (stream) => {
      stream.end(Buffer.from("A LOGIN {5}\r\n12345{3}\r\nABC\r\n"));
    },
    1,
  );
});

it("Line length cap rejects oversized line", async () => {
  const stream = new ImapStream({ cid: "test", maxLineLength: 16 });
  const err = awaitError(stream);

  stream.write(Buffer.from("AAAAAAAA"));
  stream.write(Buffer.from("BBBBBBBB"));
  stream.write(Buffer.from("CCCCCCCC"));

  const e = await err;
  expect(e.code).toBe("LineTooLarge");
  expect(e.maxSize).toBe(16);
});

it("Line length cap allows line within limit", async () => {
  const stream = new ImapStream({ cid: "test", maxLineLength: 32 });
  const payloads: string[] = [];

  const done = new Promise<void>((resolve, reject) => {
    stream.on("readable", () => {
      let cmd: ImapStreamCommand | null;
      while ((cmd = stream.read()) !== null) {
        payloads.push(cmd.payload.toString());
        cmd.next();
      }
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  stream.end(Buffer.from("A NOOP\r\n"));
  await done;

  expect(payloads).toEqual(["A NOOP"]);
});

it("ImapStream: checkLiteralMarker returns false for empty line", () => {
  const stream = new ImapStream({ cid: "t" });
  expect(stream.checkLiteralMarker(Buffer.alloc(0))).toBe(false);
  expect(stream.checkLiteralMarker(null)).toBe(false);
});

it("ImapStream: checkLiteralMarker returns false when no trailing LF", () => {
  const stream = new ImapStream({ cid: "t" });
  expect(stream.checkLiteralMarker(Buffer.from("A1 OK no newline"))).toBe(false);
});

it("ImapStream: checkLiteralMarker returns false for non-numeric marker", () => {
  const stream = new ImapStream({ cid: "t" });
  expect(stream.checkLiteralMarker(Buffer.from("A1 CMD {x}\r\n"))).toBe(false);
  expect(stream.checkLiteralMarker(Buffer.from("A1 CMD {}\r\n"))).toBe(false);
});

it("ImapStream: checkLiteralMarker activates literal state for valid marker", () => {
  const stream = new ImapStream({ cid: "t" });
  expect(stream.checkLiteralMarker(Buffer.from("A1 CMD {5}\r\n"))).toBe(true);
  expect(stream.literalWaiting).toBe(5);
});

it("ImapStream: _transform converts string chunks to Buffer", async () => {
  const stream = new ImapStream({ cid: "t" });
  const commands: string[] = [];

  const done = new Promise<void>((resolve, reject) => {
    stream.on("readable", () => {
      let cmd: ImapStreamCommand | null;
      while ((cmd = stream.read()) !== null) {
        commands.push(cmd.payload.toString());
        cmd.next();
      }
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  stream.write("A1 OK done\r\n");
  stream.end();
  await done;

  expect(commands.some((c) => /A1 OK/.test(c))).toBe(true);
});

it("ImapStream: _destroy drains pending input queue callbacks", async () => {
  const stream = new ImapStream({ cid: "t" });
  let nextCalled = false;
  stream.inputQueue.push({ chunk: Buffer.from("x"), next: () => (nextCalled = true) });
  stream.destroy();

  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  expect(nextCalled).toBe(true);
});

it("Literal marker scan stays linear on a long digit run", () => {
  const stream = new ImapStream({ cid: "test" });
  stream.on("error", () => {});
  stream.resume();

  const line = Buffer.concat([
    Buffer.from("* OK {"),
    Buffer.from("9".repeat(200000)),
    Buffer.from("}\r\n"),
  ]);

  const started = process.hrtime.bigint();
  stream.checkLiteralMarker(line);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  expect(elapsedMs < 250).toBe(true);
});

it("Literal marker fails the stream on an oversized digit run", async () => {
  const stream = new ImapStream({ cid: "test" });
  const state: { err: ImapStreamError | null } = { err: null };
  stream.on("error", (err) => {
    state.err = err;
  });
  stream.resume();

  const line = Buffer.concat([
    Buffer.from("* OK {"),
    Buffer.from("1".repeat(40)),
    Buffer.from("}\r\n"),
  ]);

  expect(stream.checkLiteralMarker(line)).toBe(false);
  expect(stream.destroyed).toBe(true);

  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  expect(state.err?.code).toBe("LiteralTooLarge");
});

it("Literal marker accepts a zero-padded size", () => {
  const stream = new ImapStream({ cid: "test" });
  stream.on("error", () => {});
  stream.resume();

  const line = Buffer.from(`* 1 FETCH (BODY[] {${"0".repeat(21)}123}\r\n`);

  expect(stream.checkLiteralMarker(line)).toBe(true);
  expect(stream.literalWaiting).toBe(123);
  stream.destroy();
});

it("Literal marker still accepts sizes at the digit-length bound", () => {
  const stream = new ImapStream({ cid: "test", maxLiteralSize: Number.MAX_SAFE_INTEGER });
  stream.on("error", () => {});
  stream.resume();

  const line = Buffer.from(`* OK {${"9".repeat(19)}}\r\n`);
  expect(stream.checkLiteralMarker(line)).toBe(false);

  const ok = new ImapStream({ cid: "test" });
  ok.on("error", () => {});
  ok.resume();
  expect(ok.checkLiteralMarker(Buffer.from("* OK {1024}\r\n"))).toBe(true);
  expect(ok.literalWaiting).toBe(1024);
});

it("Response assembly enforces the cumulative size cap", async () => {
  const stream = new ImapStream({ cid: "test", maxResponseSize: 40 });
  const state: { err: ImapStreamError | null } = { err: null };
  stream.on("error", (err) => {
    state.err = err;
  });
  stream.resume();

  stream.write(Buffer.from("* 1 FETCH (BODY[1] {10}\r\n"));
  stream.write(Buffer.from("0123456789"));
  stream.write(Buffer.from(" BODY[2] {10}\r\n0123456789)\r\n"));

  await new Promise<void>((resolve) => setTimeout(() => resolve(), 100));
  expect(state.err).toBeTruthy();
  expect(state.err?.code).toBe("ResponseTooLarge");
  expect(stream.destroyed).toBe(true);
});

it("Response size budget resets between responses", async () => {
  const line = "* OK " + "a".repeat(23) + "\r\n";
  const stream = new ImapStream({ cid: "test", maxResponseSize: 40 });
  let streamErr: ImapStreamError | null = null;
  let count = 0;
  stream.on("error", (err) => {
    streamErr = err;
  });
  stream.on("data", (cmd) => {
    count++;
    cmd.next();
  });

  expect(line.length <= 40 && line.length * 2 > 40).toBe(true);

  stream.write(Buffer.from(line + line));
  stream.end();

  const err = await settle(stream);
  expect(err).toBeNull();
  expect(streamErr).toBeNull();
  expect(count).toBe(2);
});

it("Response size cap defaults above the literal cap", () => {
  const stream = new ImapStream({ cid: "test" });
  expect(stream.maxResponseSize).toBe(2 * 1024 * 1024 * 1024);
  expect(stream.maxResponseSize > stream.maxLiteralSize).toBe(true);
});

it("A literal of exactly maxLiteralSize is accepted when the response cap leaves headroom", async () => {
  const stream = new ImapStream({ cid: "test", maxLiteralSize: 100, maxResponseSize: 200 });
  const state: { err: ImapStreamError | null; received: ImapStreamCommand | null } = {
    err: null,
    received: null,
  };
  stream.on("error", (err) => {
    state.err = err;
  });
  stream.on("data", (cmd) => {
    state.received = cmd;
    cmd.next();
  });

  stream.write(Buffer.from("* 1 FETCH (BODY[] {100}\r\n"));
  stream.write(Buffer.from("x".repeat(100)));
  stream.write(Buffer.from(")\r\n"));
  stream.end();

  const err = await settle(stream);
  expect(err).toBeNull();
  expect(state.err).toBeNull();
  expect(state.received).toBeTruthy();
  expect(state.received?.literals.length).toBe(1);
  expect(state.received?.literals[0].length).toBe(100);
});

it("An unterminated line is bounded by the response budget", async () => {
  const stream = new ImapStream({ cid: "test", maxResponseSize: 64 });
  stream.resume();

  stream.write(Buffer.from("x".repeat(1024)));

  const err = await settle(stream);
  expect(err).toBeTruthy();
  expect(err?.code).toBe("ResponseTooLarge");
  expect(stream.lineBytes <= 64).toBe(true);
});

it("Infinity disables a parser size cap", () => {
  const stream = new ImapStream({
    cid: "test",
    maxResponseSize: Infinity,
    maxLiteralSize: Infinity,
    maxLineLength: Infinity,
  });
  expect(stream.maxResponseSize).toBe(Infinity);
  expect(stream.maxLiteralSize).toBe(Infinity);
  expect(stream.maxLineLength).toBe(Infinity);
});

it("A marker line that fits the budget can still be refused for its literal", async () => {
  const stream = new ImapStream({ cid: "test", maxResponseSize: 40 });
  stream.resume();

  stream.write(Buffer.from("* 1 FETCH (BODY[1] {30}\r\n"));

  const err = await settle(stream);
  expect(err).toBeTruthy();
  expect(err?.code).toBe("ResponseTooLarge");
  expect(err?.responseSize).toBe(55);
});
