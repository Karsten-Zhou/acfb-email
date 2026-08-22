// IMAP "modified UTF-7" mailbox-name encoding (RFC 3501 §5.1.3) decoder.
//
// Non-ASCII characters are encoded between '&' and '-' (or at end of string)
// as a modified UTF-7 representation:
//   - '&' is the escape start, '-' is the escape end.
//   - A literal '&' is written as '&-'.
//   - The bytes between are UTF-16BE, then base64-encoded with ',' replacing '/'.
//     (modified UTF-7 uses ',' because '/' is a mailbox path separator).
// We only need a decoder here (we never create remote folders with non-ASCII
// names in v1), so this is one direction.

export function decodeModifiedUtf7(input: string): string {
  if (!input.includes("&")) return input;

  let out = "";
  let i = 0;
  while (i < input.length) {
    const amp = input.indexOf("&", i);
    if (amp < 0) {
      out += input.slice(i);
      break;
    }
    // ASCII run up to '&'
    out += input.slice(i, amp);
    // Find the terminating '-'
    const end = input.indexOf("-", amp);
    if (end < 0) {
      // Unpaired '&': treat as literal (shouldn't happen in valid IMAP).
      out += input.slice(amp);
      break;
    }
    const encoded = input.slice(amp + 1, end);
    if (encoded === "") {
      // "&-" is a literal ampersand
      out += "&";
    } else {
      out += decodeBase64Utf16(encoded);
    }
    i = end + 1;
  }
  return out;
}

function decodeBase64Utf16(b64: string): string {
  try {
    // Revert modified alphabet: ',' -> '/'
    const standard = b64.replace(/,/g, "/");
    const bin = atob(standard);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    // UTF-16BE decode
    let result = "";
    for (let j = 0; j + 1 < bytes.length; j += 2) {
      const code = (bytes[j] << 8) | bytes[j + 1];
      result += String.fromCharCode(code);
    }
    return result;
  } catch {
    return b64;
  }
}
