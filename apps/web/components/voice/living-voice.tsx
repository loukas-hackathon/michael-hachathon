"use client";

import { useEffect, useRef } from "react";
import { Michael, type MichaelState } from "@/components/michael";
import { onMicLevel } from "./recorder";
import { onSpeechLevel } from "./speech";

// Michael's living voice (onboarding talk and the chat's conversation sheet): the Mi mark in its
// dark core, wrapped in soft translucent pink light that moves like a voice. It is the one place
// in the app allowed glow and a continuous loop, because it is Michael himself.
//
// - Speaking: follows the real loudness of his voice (onSpeechLevel: the ElevenLabs audio's
//   envelope, or the browser voice's words).
// - Listening: leans in and follows the microphone (onMicLevel), or swells with each word heard
//   where the level cannot be read.
// - Thinking: a calm swirl, one point of light circling the core.
// - Idle: a slow breath. Muted: dimmer and still.
//
// Every change of state glides (each parameter eases towards its target), so it never jumps and
// can be interrupted at any point. Drawn on a canvas, one frame per screen refresh, colours from
// the theme tokens. Reduced motion: one still frame per state, no loop.

export type VoiceMood = "idle" | "listening" | "thinking" | "speaking" | "muted";

type Params = {
  /** Size of the light around the core. */
  aura: number;
  /** Opacity of the light. */
  glow: number;
  /** How much the shapes bend. */
  morph: number;
  /** How fast the shapes turn and change. */
  spin: number;
  /** The point of light circling while he thinks. */
  orbit: number;
  /** Size of the dark core. */
  core: number;
  /** Opacity of the core and the mark. */
  coreAlpha: number;
  /** Depth of the slow breath. */
  breath: number;
  /** How strongly the voice level moves it. */
  gain: number;
};

const MOODS: Record<VoiceMood, Params> = {
  idle: { aura: 1, glow: 0.7, morph: 0.05, spin: 0.22, orbit: 0, core: 1, coreAlpha: 1, breath: 1, gain: 0 },
  listening: {
    aura: 1.1,
    glow: 0.9,
    morph: 0.07,
    spin: 0.32,
    orbit: 0,
    core: 0.97,
    coreAlpha: 1,
    breath: 0.5,
    gain: 1,
  },
  speaking: {
    aura: 1.04,
    glow: 0.95,
    morph: 0.07,
    spin: 0.38,
    orbit: 0,
    core: 1,
    coreAlpha: 1,
    breath: 0.25,
    gain: 1,
  },
  thinking: {
    aura: 0.94,
    glow: 0.75,
    morph: 0.035,
    spin: 1,
    orbit: 1,
    core: 0.98,
    coreAlpha: 1,
    breath: 0.6,
    gain: 0,
  },
  muted: {
    aura: 0.9,
    glow: 0.28,
    morph: 0.02,
    spin: 0,
    orbit: 0,
    core: 0.96,
    coreAlpha: 0.55,
    breath: 0,
    gain: 0,
  },
};

const KEYS = Object.keys(MOODS.idle) as (keyof Params)[];

/** Microphone loudness (root mean square, speech about 0.03 to 0.15) as 0..1 for the visual. */
export function micShape(rms: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, rms - 0.006) * 7));
}

/** Eases `from` towards `to` at `rate` per second, frame rate independent. */
function approach(from: number, to: number, rate: number, dt: number): number {
  return to + (from - to) * Math.exp(-rate * dt);
}

type Rgb = [number, number, number];

function rgb(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [0, 1, 2].map((i) => Number.parseInt((hex[i] ?? "0").repeat(2), 16)) as Rgb;
  }
  return fallback;
}

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;

type Palette = { tint: Rgb; label: Rgb; bg: Rgb; dark: boolean };

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const label = rgb(css.getPropertyValue("--m-label"), [0, 0, 0]);
  return {
    tint: rgb(css.getPropertyValue("--m-tint"), [230, 0, 122]),
    bg: rgb(css.getPropertyValue("--m-bg"), [255, 255, 255]),
    label,
    // White text means a dark screen.
    dark: label[0] + label[1] + label[2] > 384,
  };
}

/** A soft closed shape: a circle whose edge bends with three slow waves. */
function blobPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  amp: number,
  ph: number,
  seed: number,
) {
  const n = 64;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bend =
      0.55 * Math.sin(2 * a + ph * 1.3 + seed) +
      0.3 * Math.sin(3 * a - ph * 0.9 + seed * 2.1) +
      0.15 * Math.sin(5 * a + ph * 1.7 + seed * 3.7);
    const rr = r * (1 + amp * bend);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A blob filled with light that fades out towards its edge. */
function glowBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  amp: number,
  ph: number,
  seed: number,
  color: Rgb,
  alpha: number,
) {
  if (alpha <= 0.002 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * (1 + amp));
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.55, rgba(color, alpha * 0.7));
  g.addColorStop(0.85, rgba(color, alpha * 0.14));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  blobPath(ctx, x, y, r, amp, ph, seed);
  ctx.fill();
}

type Frame = { p: Params; level: number; ph: number; breath: number; palette: Palette };

/** Draws one frame. `size` is the canvas side in CSS pixels; the core is a third of it across. */
function draw(ctx: CanvasRenderingContext2D, size: number, f: Frame) {
  const { p, level: L, ph, palette } = f;
  const c = size / 2;
  // The unit: the radius of the button the canvas surrounds (the canvas is 1.6 times its size, so
  // the light never meets the canvas edge).
  const u = size / 3.2;
  const breathe = Math.sin(f.breath) * p.breath;
  const lift = L * p.gain;
  const aura = (p.aura + 0.03 * breathe + 0.26 * lift) * u;
  const morph = p.morph + 0.1 * lift;
  const glow = p.glow + 0.25 * lift;
  const { tint, label, bg, dark } = palette;

  ctx.clearRect(0, 0, size, size);
  // On black the light adds up like light; on white it layers like tinted glass.
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";

  // A faint haze of the text colour for depth (grey glass on white, mist on black).
  glowBlob(ctx, c, c, aura * 1.02, morph, ph * 0.6, 4.1, label, glow * (dark ? 0.08 : 0.05));
  // Two wide pink lights turning opposite ways.
  const o1 = 0.07 * u * (1 + lift);
  glowBlob(
    ctx,
    c + Math.cos(ph * 0.7) * o1,
    c + Math.sin(ph * 0.7) * o1,
    aura,
    morph,
    ph,
    0.3,
    tint,
    glow * 0.3,
  );
  glowBlob(
    ctx,
    c + Math.cos(-ph * 0.9 + 2.2) * o1 * 1.4,
    c + Math.sin(-ph * 0.9 + 2.2) * o1 * 1.4,
    aura * 0.9,
    morph * 1.2,
    -ph * 1.1,
    1.7,
    tint,
    glow * 0.26,
  );
  // Two brighter lobes just outside the core: they give the edge its living rim.
  const o2 = (0.16 + 0.08 * lift) * u;
  for (const [k, seed, dir] of [
    [0, 2.6, 1],
    [Math.PI, 5.3, -1],
  ] as const) {
    const a = ph * 0.8 * dir + k;
    glowBlob(
      ctx,
      c + Math.cos(a) * o2,
      c + Math.sin(a) * o2,
      (0.7 + 0.12 * lift + 0.02 * breathe) * u,
      morph * 1.4,
      ph * 1.3 * dir,
      seed,
      tint,
      glow * (0.34 + 0.25 * lift),
    );
  }
  // Thinking: one point of light circling the core, with a short fading trail.
  // Thinking: two soft lights drifting round the rim of the core, opposite each other, each with a
  // fading trail. Slow (a lap takes about five seconds), so it reads as thought, not loading.
  if (p.orbit > 0.01) {
    for (const start of [0, Math.PI]) {
      for (let i = 7; i >= 0; i--) {
        const a = ph * 1.3 + start - i * 0.13;
        const r = (0.74 + 0.03 * Math.sin(ph * 0.7 + start)) * u;
        glowBlob(
          ctx,
          c + Math.cos(a) * r,
          c + Math.sin(a) * r,
          (0.26 - i * 0.012) * u,
          0,
          0,
          0,
          tint,
          p.orbit * glow * 0.42 * (1 - i / 8),
        );
      }
    }
  }

  // The core: the dark (or, on black, white) drop the mark sits in, bending a little as he talks.
  ctx.globalCompositeOperation = "source-over";
  const coreR = 0.62 * (p.core + 0.012 * breathe + 0.05 * lift) * u;
  // Opaque first in the page colour, so a dimmed core is grey, never tinted by the light behind it.
  blobPath(ctx, c, c, coreR, 0.008 + 0.035 * lift, ph * 1.5, 0.9);
  ctx.fillStyle = rgba(bg, 1);
  ctx.fill();
  ctx.fillStyle = rgba(label, p.coreAlpha);
  ctx.fill();
  // A pink rim on the core that lights up with his voice.
  if (lift > 0.02) {
    ctx.lineWidth = Math.max(1, u * 0.025);
    ctx.strokeStyle = rgba(tint, 0.55 * lift * p.coreAlpha);
    blobPath(ctx, c, c, coreR - ctx.lineWidth / 2, 0.008 + 0.035 * lift, ph * 1.5, 0.9);
    ctx.stroke();
  }
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The living voice. Fills its (square, positioned) parent: the light spills past the parent's edge
 * without taking layout room. `level` is a microphone level from the caller (a recording's), used
 * beside the shared meters; `words` swells it with each word heard.
 */
export function LivingVoice({
  mood,
  level = 0,
  words = 0,
  mi,
  levelTestId,
}: {
  mood: VoiceMood;
  level?: number;
  words?: number;
  /** The mark's own state; follows the mood when left out. */
  mi?: MichaelState;
  /** A test id on the canvas while it shows a live microphone level. */
  levelTestId?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const moodRef = useRef(mood);
  const propLevel = useRef(level);
  const heard = useRef(0);
  const redraw = useRef<() => void>(() => {});
  moodRef.current = mood;
  propLevel.current = level;

  // Each new word heard: a small swell that dies away.
  useEffect(() => {
    if (words) heard.current = 1;
  }, [words]);

  // A new state: under reduced motion this is the only time the still frame changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw on each new mood
  useEffect(() => {
    redraw.current();
  }, [mood]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let size = 0;
    let palette = readPalette(el);
    const p: Params = { ...MOODS[moodRef.current] };
    let speech = 0;
    let mic = 0;
    let L = 0;
    let ph = Math.random() * 10;
    let breath = 0;
    let last = performance.now();
    let frame = 0;
    let still = reduced();

    const fit = () => {
      const box = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = box.width;
      el.width = Math.round(box.width * dpr);
      el.height = Math.round(box.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = () => {
      draw(ctx, size, { p, level: L, ph, breath, palette });
      if (mark.current) {
        const k = p.core + 0.012 * Math.sin(breath) * p.breath + 0.05 * L * p.gain;
        mark.current.style.transform = `scale(${k.toFixed(4)})`;
        mark.current.style.opacity = String(p.coreAlpha);
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const target = MOODS[moodRef.current];
      // State changes glide over about a third of a second.
      for (const k of KEYS) p[k] = approach(p[k], target[k], 5, dt);
      heard.current = approach(heard.current, 0, 3.5, dt);
      const m = moodRef.current;
      const raw =
        m === "speaking"
          ? speech
          : m === "listening"
            ? Math.max(micShape(Math.max(mic, propLevel.current)), heard.current * 0.6)
            : 0;
      // Quick to rise, slower to fall: a voice, not a meter.
      L = approach(L, raw, raw > L ? 22 : 7, dt);
      ph += dt * (p.spin + 0.5 * L * p.gain);
      breath += dt * ((Math.PI * 2) / 4.2);
      paint();
      frame = requestAnimationFrame(tick);
    };

    const stillFrame = () => {
      Object.assign(p, MOODS[moodRef.current]);
      L = 0;
      breath = 0;
      paint();
    };

    let visible = true;
    const start = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (still) return stillFrame();
      if (!visible) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };

    redraw.current = () => {
      if (still) stillFrame();
    };

    fit();
    start();

    const offSpeech = onSpeechLevel((l) => {
      speech = l;
    });
    const offMic = onMicLevel((l) => {
      mic = l;
    });
    const resize = new ResizeObserver(() => {
      fit();
      if (still) stillFrame();
    });
    resize.observe(el);
    // Off screen (the sheet closed, scrolled away): no frames at all.
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      start();
    });
    seen.observe(el);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      still = motion.matches;
      start();
    };
    motion.addEventListener("change", onMotion);
    // The theme can change under it (system dark mode, or the app's own setting).
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => {
      palette = readPalette(el);
      if (still) stillFrame();
    };
    scheme.addEventListener("change", onTheme);
    const themeWatch = new MutationObserver(onTheme);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      cancelAnimationFrame(frame);
      offSpeech();
      offMic();
      resize.disconnect();
      seen.disconnect();
      motion.removeEventListener("change", onMotion);
      scheme.removeEventListener("change", onTheme);
      themeWatch.disconnect();
      redraw.current = () => {};
    };
  }, []);

  const state: MichaelState =
    mi ??
    (mood === "muted"
      ? "asleep"
      : mood === "listening" || mood === "thinking" || mood === "speaking"
        ? mood
        : "idle");

  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvas}
        data-testid={levelTestId}
        data-mood={mood}
        className="absolute top-[-30%] left-[-30%] h-[160%] w-[160%]"
      />
      <span ref={mark} className="absolute inset-0 grid place-items-center text-bg">
        <Michael state={state} className="block h-auto w-[32%]" />
      </span>
    </span>
  );
}
