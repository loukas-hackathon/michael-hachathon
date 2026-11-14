import type { ApiError, ErrorCode } from "@michael/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  upstream_error: 502,
  not_implemented: 501,
  internal: 500,
};

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, code: ErrorCode, message: string, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return c.json(body, STATUS[code]);
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError("bad_request", "Validation failed", result.error.issues);
  }
  return result.data;
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError("bad_request", "Body must be valid JSON");
  }
}

export const notImplemented = (what: string) => (c: Context) =>
  errorResponse(c, "not_implemented", `${what} is not implemented yet`);
