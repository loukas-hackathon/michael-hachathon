"use client";

// Michael's three earcons ("Yo Michael", components/voice/wake-island.tsx): one family, the same
// timbre (a sine with a soft triangle partial at 20%) on E and B, so they sound related. Rendered
// once into AudioBuffers (sample by sample, no reverb), 6ms attack and an exponential release, and
// played on the one shared AudioContext that the first tap unlocks (iOS plays nothing before one).
// Never louder than about minus 15 dBFS and at least 6dB under his voice. No sound for thinking,
// speaking, nudges or interruptions, and nothing that resembles the Siri chime.

export type Earcon = "wake" | "end" | "missed";

type Note = { hz: number; to?: number; at: number; ms: number };

/** The notes of each earcon and its peak gain. */
const SPECS: Record<Earcon, { gain: number; notes: Note[] }> = {
  // A rising fifth: E5 then B5, 90ms each, overlapping by 40ms (140ms in all).
  wake: {
    gain: 0.18,
    notes: [
      { hz: 659.25, at: 0, ms: 90 },
      { hz: 987.77, at: 50, ms: 90 },
    ],
  },
  // The same fifth falling: B5 then E5, 80ms each (130ms).
  end: {
    gain: 0.12,
    notes: [
      { hz: 987.77, at: 0, ms: 80 },
      { hz: 659.25, at: 50, ms: 80 },
    ],
  },
  // One A4 with a slight fall to 415Hz (120ms).
  missed: { gain: 0.12, notes: [{ hz: 440, to: 415, at: 0, ms: 120 }] },
};

const ATTACK_S = 0.006;

let ctx: AudioContext | null = null;
const buffers = new Map<Earcon, AudioBuffer>();

/** The shared context, made on first use. Null where the browser has no Web Audio. */
export function earconContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Renders one earcon's samples: sine plus a 20% triangle, attack and exponential release. */
export function renderEarcon(kind: Earcon, sampleRate: number): Float32Array<ArrayBuffer> {
  const spec = SPECS[kind];
  const lengthMs = Math.max(...spec.notes.map((n) => n.at + n.ms));
  const out = new Float32Array(Math.ceil((lengthMs / 1000) * sampleRate));
  for (const n of spec.notes) {
    const start = Math.floor((n.at / 1000) * sampleRate);
    const len = Math.floor((n.ms / 1000) * sampleRate);
    let phase = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / sampleRate;
      const p = i / len;
      const hz = n.to ? n.hz + (n.to - n.hz) * p : n.hz;
      phase += (2 * Math.PI * hz) / sampleRate;
      const sine = Math.sin(phase);
      // A triangle an octave up, a fifth of the level: the soft edge that makes it a tone, not a beep.
      const tri = (2 / Math.PI) * Math.asin(Math.sin(phase * 2));
      const env = t < ATTACK_S ? t / ATTACK_S : Math.exp(-5 * ((t - ATTACK_S) / (n.ms / 1000)));
      out[start + i] = (out[start + i] ?? 0) + spec.gain * env * (0.8 * sine + 0.2 * tri);
    }
  }
  // Two notes overlap: never past the peak.
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-spec.gain, Math.min(spec.gain, out[i] ?? 0));
  return out;
}

/** Makes the three buffers (cheap; done at the tap that turns Yo Michael on, and on first use). */
export function primeEarcons(): void {
  const c = earconContext();
  if (!c) return;
  void c.resume().catch(() => {});
  for (const kind of Object.keys(SPECS) as Earcon[]) {
    if (buffers.has(kind)) continue;
    try {
      const data = renderEarcon(kind, c.sampleRate);
      const buf = c.createBuffer(1, data.length, c.sampleRate);
      buf.copyToChannel(data, 0);
      buffers.set(kind, buf);
    } catch {
      // No buffer: that earcon stays silent; the island and the haptic still answer.
    }
  }
}

/** Plays one earcon now. Silent where the browser will not play sound yet. */
export function playEarcon(kind: Earcon): void {
  const c = earconContext();
  if (!c) return;
  try {
    primeEarcons();
    const buf = buffers.get(kind);
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
  } catch {
    // No sound: the island is the sign.
  }
}
