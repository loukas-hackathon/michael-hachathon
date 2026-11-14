import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { decodeProto, protoDouble, protoInt, protoString, readSegb2 } from "../segb";
import {
  buildIntervals,
  decodeFocusEvent,
  deviceOf,
  type FocusEvent,
  isSystemSurface,
  openedFrom,
} from "./iphone-usage";

// Everything here is made up: invented bundle ids and times, built into the same bytes Biome writes.

const varint = (value: number) => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
};
const tag = (field: number, wire: number) => varint(field * 8 + wire);
const text = (field: number, value: string) =>
  Buffer.concat([tag(field, 2), varint(Buffer.byteLength(value)), Buffer.from(value)]);
const int = (field: number, value: number) => Buffer.concat([tag(field, 0), varint(value)]);
const double = (field: number, value: number) => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return Buffer.concat([tag(field, 1), bytes]);
};

type Fake = { at: number; bundle: string; starting: boolean; reason?: string; kind?: number };

const focusPayload = (fake: Fake) =>
  Buffer.concat([
    ...(fake.reason ? [text(1, fake.reason)] : []),
    int(2, fake.kind ?? 1),
    int(3, fake.starting ? 1 : 0),
    double(4, fake.at),
    text(6, fake.bundle),
    text(9, "1.0"),
    text(10, "100"),
    int(13, 1),
  ]);

/** A SEGB version 2 file: header, records padded to 4 bytes, zero filler, trailer. */
function segb(records: { payload: Buffer; state: number; at: number; breakCrc?: boolean }[], size = 4096) {
  const file = Buffer.alloc(size);
  file.write("SEGB", 0, "latin1");
  file.writeInt32LE(records.length, 4);
  file.writeDoubleLE(records[0]?.at ?? 0, 8);
  let offset = 0;
  records.forEach((record, index) => {
    const start = 32 + Math.ceil(offset / 4) * 4;
    // A deleted record keeps its slot, but its bytes are wiped.
    const payload = record.state === 1 ? record.payload : Buffer.alloc(record.payload.length);
    file.writeUInt32LE(record.state === 1 ? (crc32(payload) + (record.breakCrc ? 1 : 0)) >>> 0 : 0, start);
    payload.copy(file, start + 8);
    offset = start - 32 + 8 + payload.length;
    // The trailer grows backwards from the end of the file.
    const slot = size - (index + 1) * 16;
    file.writeInt32LE(offset, slot);
    file.writeInt32LE(record.state, slot + 4);
    file.writeDoubleLE(record.at, slot + 8);
  });
  return file;
}

const T = 800_000_000; // some moment in 2026, in seconds since 2001

test("reads written records and skips deleted, unwritten and damaged ones", () => {
  const fakes: Fake[] = [
    {
      at: T,
      bundle: "com.example.Notes",
      starting: true,
      reason: "com.apple.SpringBoard.transitionReason.homescreen",
    },
    { at: T + 30, bundle: "com.example.Notes", starting: false },
    { at: T + 31, bundle: "com.example.Deleted", starting: true },
    { at: T + 40, bundle: "com.example.Maps", starting: true },
    { at: T + 50, bundle: "com.example.Damaged", starting: true },
  ];
  const file = segb([
    { payload: focusPayload(fakes[0] as Fake), state: 1, at: T },
    { payload: focusPayload(fakes[1] as Fake), state: 1, at: T + 30 },
    { payload: focusPayload(fakes[2] as Fake), state: 3, at: T + 31 },
    { payload: focusPayload(fakes[3] as Fake), state: 1, at: T + 40 },
    { payload: focusPayload(fakes[4] as Fake), state: 1, at: T + 50, breakCrc: true },
    { payload: Buffer.alloc(0), state: 4, at: 0 },
  ]);
  const { records, skipped } = readSegb2(file);
  const events = records.map((record) => decodeFocusEvent(record.payload));
  assert.deepEqual(
    events.map((event) => event?.bundleId),
    ["com.example.Notes", "com.example.Notes", "com.example.Maps"],
  );
  assert.equal(skipped, 3);
  assert.equal(records[1]?.writtenAt, T + 30);
  assert.deepEqual(events[0], {
    at: T,
    bundleId: "com.example.Notes",
    starting: true,
    kind: 1,
    reason: "com.apple.SpringBoard.transitionReason.homescreen",
  });
});

test("decodes the four protobuf wire types and rejects damage", () => {
  const fixed32 = Buffer.concat([tag(5, 5), Buffer.from([1, 0, 0, 0])]);
  const message = decodeProto(Buffer.concat([int(2, 300), double(4, 1.5), text(6, "héllo"), fixed32]));
  assert.equal(protoInt(message, 2), 300);
  assert.equal(protoDouble(message, 4), 1.5);
  assert.equal(protoString(message, 6), "héllo");
  assert.equal(message.get(5)?.[0]?.wire, 5);
  assert.equal(protoString(message, 2), undefined);
  assert.throws(() => decodeProto(Buffer.concat([tag(6, 2), varint(50), Buffer.from("short")])));
  assert.equal(decodeFocusEvent(Buffer.from([0xff, 0xff])), null);
});

const event = (
  at: number,
  bundleId: string,
  starting: boolean,
  extra: Partial<FocusEvent> = {},
): FocusEvent => ({
  at: T + at,
  bundleId,
  starting,
  kind: 1,
  reason: undefined,
  ...extra,
});
const spans = (events: FocusEvent[]) =>
  buildIntervals(events).map((interval) => [
    interval.bundleId.split(".").pop(),
    interval.start - T,
    interval.end - T,
  ]);

test("pairs gained with lost focus, in time order", () => {
  const events = [
    event(100, "com.example.B", true),
    event(130, "com.example.B", false),
    event(0, "com.example.A", true),
    event(60, "com.example.A", false),
  ];
  assert.deepEqual(spans(events), [
    ["A", 0, 60],
    ["B", 100, 130],
  ]);
});

test("a missing end closes at the next event, capped at two hours", () => {
  const events = [
    event(0, "com.example.A", true),
    event(40, "com.example.B", true), // A never lost focus
    event(50, "com.example.B", false),
    event(100, "com.example.C", true),
    event(100 + 9 * 3600, "com.example.D", true), // C never lost focus, and the phone was idle for hours
    event(100 + 9 * 3600 + 5, "com.example.D", false),
  ];
  assert.deepEqual(spans(events), [
    ["A", 0, 40],
    ["B", 40, 50],
    ["C", 100, 100 + 2 * 3600],
    ["D", 100 + 9 * 3600, 100 + 9 * 3600 + 5],
  ]);
});

test("duplicate starts, stray ends and an unfinished last app", () => {
  const events = [
    event(0, "com.example.A", false), // its start fell before the window
    event(10, "com.example.A", true),
    event(20, "com.example.A", true), // gained twice
    event(30, "com.example.A", false),
    event(40, "com.example.B", true), // still in front: no end yet, so not reported
  ];
  assert.deepEqual(spans(events), [
    ["A", 10, 20],
    ["A", 20, 30],
  ]);
});

test("system surfaces are boundaries, not usage", () => {
  const events = [
    event(0, "com.example.A", true),
    event(25, "com.apple.control-center", true, { kind: 3 }), // A's own end is missing
    event(30, "com.apple.control-center", false, { kind: 3 }),
  ];
  const intervals = buildIntervals(events);
  assert.deepEqual(
    intervals.map((interval) => interval.end - interval.start),
    [25, 5],
  );
  assert.deepEqual(
    intervals.map((interval) => isSystemSurface(interval.bundleId, interval.kind)),
    [false, true],
  );
  assert.equal(isSystemSurface("com.apple.springboard.today-view"), true);
  assert.equal(isSystemSurface("com.apple.carousel.clock"), true);
  assert.equal(isSystemSurface("com.apple.ScreenshotServicesService"), true);
  assert.equal(isSystemSurface("com.apple.InCallService"), false);
  assert.equal(isSystemSurface("com.example.BackgroundService"), false);
  assert.equal(isSystemSurface("com.apple.mobilesafari"), false);
});

test("maps transition reasons to where the app was opened from", () => {
  const sb = "com.apple.SpringBoard.transitionReason";
  const trail = "SBSceneLayoutWorkspaceTransaction:00000000-0000-0000-0000-000000000000";
  assert.equal(openedFrom(undefined), undefined);
  assert.equal(openedFrom(`${trail}, ${sb}.homescreen`), "home_screen");
  assert.equal(openedFrom(`${sb}.widget`), "home_screen");
  assert.equal(openedFrom(`${sb}.appswitcher`), "app_switcher");
  assert.equal(
    openedFrom(`${trail}, ${sb}.systemgesture, SBWorkspace, ${trail}, ${sb}.homescreen`),
    "home_screen",
  );
  assert.equal(openedFrom(`${trail}, ${sb}.notification`), "notification");
  assert.equal(openedFrom(`${sb}.notification, ${sb}.homescreen`), "notification");
  assert.equal(openedFrom(`SBSourceApplication:com.example.A, ${sb}.externalrequest`), "other");
  assert.equal(openedFrom("com.apple.SpringBoard.backlight.transitionReason.liftToWake"), "other");
  assert.equal(
    openedFrom(`${sb}.appswitcher, com.apple.SpringBoard.backlight.transitionReason.touch`),
    "app_switcher",
  );
  assert.equal(openedFrom("SBFullScreenSwitcherSceneLiveContentOverlay"), "other");
  assert.equal(openedFrom("iconTap"), "home_screen");
  assert.equal(openedFrom("crown tap"), "other");
});

test("tells a watch from a phone by what runs on it", () => {
  assert.equal(
    deviceOf([event(0, "com.apple.carousel.clock", true), event(5, "com.example.A", true)]),
    "watch",
  );
  assert.equal(deviceOf([event(0, "com.example.A", true)]), "iphone");
});
