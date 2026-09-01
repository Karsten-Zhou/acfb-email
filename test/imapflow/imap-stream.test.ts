// Port of imapflow's `test/imap-stream-test.js` run under the Cloudflare Workers
// runtime (via @cloudflare/vitest-plugin), so it exercises the patched
// `ImapStream` (`lib/handler/imap-stream.js`) under the same stream-timing
// semantics as production. Upstream uses nodeunit + `test.done()`; here we use
// vitest and drive the stream's readable side with a backpressure-safe reader.
//
// The upstream tests are CommonJS + Node Buffers. Under the plugin's types,
// `Buffer` is modelled as `Uint8Array`, so payloads/literals are read with a
// byte-preserving TextDecoder instead of Buffer methods.
import { it, expect } from "vitest";
import { ImapStream, type ImapStreamCommand } from "imapflow/lib/handler/imap-stream";
import { parser } from "imapflow/lib/handler/imap-handler";

// Runtime payloads/literals are Node Buffers; decode byte-preservingly (latin1)
// for the human-readable assertions below.
const latin1 = new TextDecoder("latin1");
const encoder = new TextEncoder();

/**
 * Consumes a readable-object-mode ImapStream without dropping 'readable' events.
 * `command.next()` only schedules a microtask (it resolves the stream's push
 * backpressure), so a plain synchronous drain — with no reentrancy guard — reads
 * every pushed command and never strands one while a later 'readable' fires.
 */
function consume(stream: ImapStream): Promise<ImapStreamCommand[]> {
  return new Promise((resolve, reject) => {
    const commands: ImapStreamCommand[] = [];
    const drain = () => {
      let command: ImapStreamCommand | null;
      while ((command = stream.read()) !== null) {
        commands.push(command);
        command.next();
      }
    };
    stream.on("readable", drain);
    stream.on("error", reject);
    stream.on("end", () => {
      drain();
      resolve(commands);
    });
  });
}

const PIPELINED_INPUT = encoder.encode(
  `A CAPABILITY
A LOGIN "aaa" "bbb"
A APPEND INBOX {5}
12345
A LOGIN {5}
12345 {11}
12345678901 "another"
A LOGOUT
`.replace(/\r?\n/g, "\r\n"),
);

const EXPECTED: Array<{ command: string; literals: string[] }> = [
  { command: "A CAPABILITY", literals: [] },
  { command: 'A LOGIN "aaa" "bbb"', literals: [] },
  { command: "A APPEND INBOX {5}\r\n", literals: ["12345"] },
  { command: 'A LOGIN {5}\r\n {11}\r\n "another"', literals: ["12345", "12345678901"] },
  { command: "A LOGOUT", literals: [] },
];

function assertPipelined(commands: ImapStreamCommand[]): void {
  expect(commands.length).toBe(EXPECTED.length);
  commands.forEach((command, i) => {
    expect({
      command: latin1.decode(command.payload),
      literals: command.literals.map((literal) => latin1.decode(literal)),
    }).toEqual(EXPECTED[i]);
  });
}

it("parses a fully pipelined command stream (single write)", async () => {
  const stream = new ImapStream();
  const done = consume(stream);
  stream.end(PIPELINED_INPUT);
  assertPipelined(await done);
});

it("extracts literal8 content intact, NUL bytes included", async () => {
  const input = encoder.encode("* 1 FETCH (BINARY[1] ~{5}\r\nhel\x00o)\r\n");
  const stream = new ImapStream();
  const done = consume(stream);
  stream.end(input);

  const commands = await done;
  expect(commands.length).toBe(1);
  const [command] = commands;
  expect(latin1.decode(command.payload)).toBe("* 1 FETCH (BINARY[1] ~{5}\r\n)");
  expect(command.literals.length).toBe(1);
  // Compare by byte content: vitest's toEqual treats a Node Buffer and a plain
  // Uint8Array as different shapes, so flatten to a number array.
  expect(Array.from(command.literals[0])).toEqual([0x68, 0x65, 0x6c, 0x00, 0x6f]);

  // The parser consumes the literal8 into a LITERAL node with the NUL intact.
  const parsed = await parser(command.payload, { literals: command.literals });
  const literalNode = parsed.attributes[1][1] as { type: string; value: Uint8Array };
  expect(literalNode.type).toBe("LITERAL");
  expect(Array.from(literalNode.value)).toEqual([0x68, 0x65, 0x6c, 0x00, 0x6f]);
});

it("handles byte-by-byte writes with backpressure", async () => {
  const stream = new ImapStream();
  const done = consume(stream);

  for (let i = 0; i < PIPELINED_INPUT.length; i++) {
    if (stream.write(PIPELINED_INPUT.subarray(i, i + 1)) === false) {
      await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  stream.end();

  assertPipelined(await done);
});
