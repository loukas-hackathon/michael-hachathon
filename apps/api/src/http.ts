import type { ApiError, ErrorCode } from "@michael/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  upstream_error: 502,
  not_implemented: 501,
  unavailable: 503,
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

/** A PostgREST error: Postgres' SQLSTATE in `code`. */
export type DbError = { message: string; code?: string };

/**
 * The HttpError for a failed database call. A write that names a user who no longer exists
 * (foreign key to auth.users, 23503) means the caller's sign in outlived its account: a deleted
 * account's access token still verifies locally until it expires (auth.ts). That is a 401, so the
 * web app signs out and asks for a fresh sign in, never a 502.
 */
export function dbError(error: DbError): HttpError {
  if (error.code === "23503" && /user_id_fkey/.test(error.message)) {
    return new HttpError("unauthorized", "Your sign in has ended. Sign in again.");
  }
  return new HttpError("upstream_error", `Database error: ${error.message}`);
}
