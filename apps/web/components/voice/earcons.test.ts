import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEarcon } from "./earcons";

// The three earcons: their lengths, and that none is louder than about minus 15 dBFS.

const RATE = 48_000;
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const ms = (a: Float32Array) => Math.round((a.length / RATE) * 1000);

test("wake: a rising fifth over 140ms, the loudest at about minus 15 dBFS", () => {
  const wake = renderEarcon("wake", RATE);
  assert.equal(ms(wake), 140);
  assert.ok(peak(wake) <= 0.18 + 1e-6);
  assert.ok(peak(wake) > 0.1, "audible");
});

test("end and missed are quieter and shorter", () => {
  const end = renderEarcon("end", RATE);
  const missed = renderEarcon("missed", RATE);
  assert.equal(ms(end), 130);
  assert.equal(ms(missed), 120);
  assert.ok(peak(end) <= 0.12 + 1e-6);
  assert.ok(peak(missed) <= 0.12 + 1e-6);
  // Every one ends near silence: no click at the cut.
  for (const a of [end, missed, renderEarcon("wake", RATE)]) assert.ok(Math.abs(a.at(-1) ?? 0) < 0.01);
});
