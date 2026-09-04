// White-box regression test for the patched `ImapFlow.socketReadable` guard
// (`lib/imap-flow.js`). On workerd a `'readable'` event can fire while a previous
// reader() is still awaiting handleResponse (so `this.reading` is still true); the
// pre-patch guard dropped that event and the connection stalled. The fix remembers
// the missed event in `_readPending` and re-runs the reader from `.finally()`.
//
// No real socket or IMAP server is needed: the patched `socketReadable` is a pure
// guard over `this.reader()`, so we install the real `setEventHandlers()` wiring and
// drive `reader()` with a stub we control. Under workerd this reproduces the exact
// "readable while reading" interleaving deterministically.
import { it, expect } from "vitest";
import { ImapFlow } from "imapflow";

// The members our test drives are not part of imapflow's public types.
interface ImapFlowInternals {
  streamer: { destroy(): void };
  reading: boolean;
  _readPending: boolean;
  socketReadable: () => void;
  reader(): Promise<void>;
  setEventHandlers(): void;
}

function newClient(): ImapFlow & ImapFlowInternals {
  // Same minimal construction imapflow's own unit tests use (no connect()).
  return new ImapFlow({
    host: "127.0.0.1",
    port: 993,
    logger: false,
    auth: { user: "test", pass: "secret" },
  }) as ImapFlow & ImapFlowInternals;
}

it("re-runs the reader when a 'readable' arrives mid-flight (workerd socketReadable race)", async () => {
  const client = newClient();

  let readerCalls = 0;
  client.reader = async () => {
    readerCalls++;
  };

  // Install the real patched socketReadable, bound to the (unused) streamer.
  client.setEventHandlers();

  // First 'readable' starts the reader loop (this.reading === true).
  client.socketReadable();
  // Workerd fires 'readable' again while the first reader is still in flight (before its
  // .finally() resets this.reading). Pre-patch this second event was silently dropped and
  // the connection stalled; the fix records it in _readPending and re-runs below.
  client.socketReadable();

  // Yield so the first reader's .finally() runs (and, with the patch, the re-run settles).
  await new Promise((resolve) => setImmediate(resolve));

  // The second 'readable' must not be lost: the reader loop runs a second time.
  expect(client.reading).toBe(false);
  expect(readerCalls).toBe(2);

  client.streamer.destroy();
});

it("a mid-flight 'readable' re-runs the reader only once", async () => {
  const client = newClient();

  let readerCalls = 0;
  client.reader = async () => {
    readerCalls++;
  };
  client.setEventHandlers();

  // A burst of two extra 'readable' events while reading is still true collapse into one
  // re-run: the flag is a single pending marker, not a counter.
  client.socketReadable();
  client.socketReadable();
  client.socketReadable();

  await new Promise((resolve) => setImmediate(resolve));

  // Initial run + one coalesced re-run, not three.
  expect(readerCalls).toBe(2);

  client.streamer.destroy();
});
