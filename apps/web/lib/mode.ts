import "server-only";

// Where the web app's data comes from. One place, so no screen can drift back to sample data.
//
// Real data is the default everywhere. Fixtures from @michael/shared only when asked for:
// - USE_MOCKS=true, or
// - local dev (not a production build) with no API_URL set, so `pnpm dev` works offline.
// A deployed app never shows sample data unless USE_MOCKS=true is set on purpose. Individual
// screens still preview the sample with ?demo=sample.

const explicit = process.env.USE_MOCKS;

export const USE_MOCKS =
  explicit === "true" ||
  (explicit !== "false" && !process.env.API_URL && process.env.NODE_ENV !== "production");

export const API_URL = process.env.API_URL ?? "http://localhost:8787";
export const API_KEY = process.env.API_KEY ?? "dev-key";
