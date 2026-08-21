// A typed HTTP error that maps to a JSON response with a safe message.
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly publicMessage: string;
  readonly code: string;

  constructor(status: ContentfulStatusCode, message: string, code = "error") {
    super(message);
    this.status = status;
    this.publicMessage = message;
    this.code = code;
  }
}
