import assert from "node:assert/strict";
import { test } from "node:test";
import { categoriseHost } from "@michael/shared";
import { siteCategory } from "./site-categories";

test("the collector labels sites with the shared categoriser, unknown sites carry no category", () => {
  for (const host of ["mail.google.com", "github.com", "www.amazon.de", "easyjet.com", "claude.ai"]) {
    assert.equal(siteCategory(host), categoriseHost(host), host);
  }
  assert.equal(siteCategory("google.co.uk"), undefined);
  assert.equal(siteCategory("unknown.example.com"), undefined);
});
