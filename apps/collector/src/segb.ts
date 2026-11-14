import { crc32 } from "node:zlib";

// Readers for the two formats Apple's Biome store uses: the SEGB version 2 container (one file is
// one "segment" of a stream) and the protobuf messages inside it. Both are small enough to decode
// by hand, so the collector needs no extra dependency. Layout learned from CCL's and Cellebrite's
// public write-ups of the format and checked against real files (macOS 26, iOS 18 and later).
//
// SEGB version 2, all numbers little endian:
//
//   offset 0, 32 bytes   header: "SEGB", int32 number of trailer slots, float64 creation time,
//                        16 bytes we do not need
//   offset 32            records, each: uint32 CRC-32 of the payload, int32 (unused here), payload.
//                        The next record starts on the next 4 byte boundary.
//   end of file          trailer: one 16 byte slot per record: int32 end of the record (counted
//                        from offset 32), int32 state, float64 time written (seconds since 2001).
//
// Files are preallocated, so everything between the last record and the trailer is zeros.

const MAGIC = "SEGB";
const HEADER_LENGTH = 32;
const RECORD_HEADER_LENGTH = 8;
const TRAILER_SLOT_LENGTH = 16;

/** Trailer states. Only written records carry data we can trust. */
const STATE_WRITTEN = 1;
// 3 = deleted (the payload is usually wiped), 4 = reserved but never written, 0 = unused slot.

export type SegbRecord = {
  /** When Biome wrote the record, in seconds since 2001-01-01. */
  writtenAt: number;
  payload: Buffer;
};

export type SegbFile = {
  records: SegbRecord[];
  /** Slots that were deleted, never written, or failed their checksum. */
  skipped: number;
};

export const isSegb2 = (file: Buffer) =>
  file.length >= HEADER_LENGTH && file.toString("latin1", 0, 4) === MAGIC;

/** Reads every intact, written record of one SEGB version 2 file. Never throws on damaged slots. */
export function readSegb2(file: Buffer): SegbFile {
  if (!isSegb2(file)) throw new Error("Not a SEGB version 2 file");
  const slots = file.readInt32LE(4);
  const trailerStart = file.length - slots * TRAILER_SLOT_LENGTH;
  if (slots < 0 || trailerStart < HEADER_LENGTH)
    throw new Error("SEGB header has an impossible record count");

  const entries: { end: number; state: number; writtenAt: number }[] = [];
  for (let i = 0; i < slots; i++) {
    const at = trailerStart + i * TRAILER_SLOT_LENGTH;
    const end = file.readInt32LE(at);
    const state = file.readInt32LE(at + 4);
    if (end <= 0) continue; // unused slot
    entries.push({ end, state, writtenAt: file.readDoubleLE(at + 8) });
  }
  // Slots are not guaranteed to be in file order; the end offsets are.
  entries.sort((a, b) => a.end - b.end);

  const records: SegbRecord[] = [];
  let skipped = 0;
  let previousEnd = 0;
  for (const entry of entries) {
    // A record starts where the previous one ended, rounded up to 4 bytes.
    const start = HEADER_LENGTH + Math.ceil(previousEnd / 4) * 4;
    const end = HEADER_LENGTH + entry.end;
    const repeated = entry.end === previousEnd; // a second slot for the same bytes
    previousEnd = entry.end;
    if (
      entry.state !== STATE_WRITTEN ||
      repeated ||
      end > trailerStart ||
      end - start < RECORD_HEADER_LENGTH
    ) {
      skipped++;
      continue;
    }
    const payload = file.subarray(start + RECORD_HEADER_LENGTH, end);
    if (crc32(payload) !== file.readUInt32LE(start)) {
      skipped++;
      continue;
    }
    records.push({ writtenAt: entry.writtenAt, payload });
  }
  return { records, skipped };
}

// Protobuf wire format, the four kinds Biome uses. Groups (wire types 3 and 4) are long
// deprecated and treated as damage.

export type ProtoValue =
  | { wire: 0; varint: bigint }
  | { wire: 1; bytes: Buffer }
  | { wire: 2; bytes: Buffer }
  | { wire: 5; bytes: Buffer };

/** Field number to every value seen for it, in order. */
export type ProtoMessage = Map<number, ProtoValue[]>;

export function decodeProto(buffer: Buffer): ProtoMessage {
  const message: ProtoMessage = new Map();
  let at = 0;

  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (at >= buffer.length) throw new Error("Protobuf varint runs past the end");
      const byte = buffer[at++] as number;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("Protobuf varint is too long");
  };
  const take = (length: number) => {
    if (length < 0 || at + length > buffer.length) throw new Error("Protobuf field runs past the end");
    const bytes = buffer.subarray(at, at + length);
    at += length;
    return bytes;
  };

  while (at < buffer.length) {
    const tag = varint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field === 0) throw new Error("Protobuf field number 0");
    let value: ProtoValue;
    if (wire === 0) value = { wire, varint: varint() };
    else if (wire === 1) value = { wire, bytes: take(8) };
    else if (wire === 2) value = { wire, bytes: take(Number(varint())) };
    else if (wire === 5) value = { wire, bytes: take(4) };
    else throw new Error(`Protobuf wire type ${wire} is not supported`);
    const list = message.get(field);
    if (list) list.push(value);
    else message.set(field, [value]);
  }
  return message;
}

// Typed getters. Each returns undefined when the field is missing or has another wire type, and
// takes the last value, which is what protobuf says wins for a repeated scalar.

const last = (message: ProtoMessage, field: number) => message.get(field)?.at(-1);

export function protoString(message: ProtoMessage, field: number): string | undefined {
  const value = last(message, field);
  return value?.wire === 2 ? value.bytes.toString("utf8") : undefined;
}

export function protoDouble(message: ProtoMessage, field: number): number | undefined {
  const value = last(message, field);
  return value?.wire === 1 ? value.bytes.readDoubleLE(0) : undefined;
}

export function protoInt(message: ProtoMessage, field: number): number | undefined {
  const value = last(message, field);
  return value?.wire === 0 ? Number(BigInt.asIntN(64, value.varint)) : undefined;
}
