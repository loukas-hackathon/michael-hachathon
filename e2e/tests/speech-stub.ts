import type { Page } from "@playwright/test";

// Shared by the voice specs: a scripted recogniser (window.__voice) and a speech synthesiser that
// records what Michael says instead of playing it.

export type Mode = {
  recognition?: boolean;
  standalone?: boolean;
  /** iPhone Safari (not a home screen app): no speaking over Michael. */
  iphone?: boolean;
  /** Michael's lines are held until the test calls __voice.finish(), or the app cancels them. */
  holdSpeech?: boolean;
  /** The microphone is refused (getUserMedia rejects), for the recorder path. */
  micDenied?: boolean;
};

/** Installs the scripted recogniser and the recording speech synthesiser before any app code runs. */
export async function stubSpeech(page: Page, mode: Mode = {}) {
  await page.addInitScript((m: Mode) => {
    type Handler = ((e: unknown) => void) | null;
    const w = window as unknown as Record<string, unknown>;
    const held: SpeechSynthesisUtterance[] = [];
    const state = {
      recs: [] as Fake[],
      spoken: [] as string[],
      started: 0,
      /** When each recogniser started and when each ended (performance.now), for restart timing. */
      starts: [] as number[],
      ends: [] as number[],
      primed: 0,
      cancelled: 0,
      /** Lines still being said (holdSpeech). */
      held: () => held.length,
      /** Michael finishes what he is saying. */
      finish() {
        for (const u of held.splice(0)) u.onend?.(new Event("end") as SpeechSynthesisEvent);
      },
    };
    w.__voice = state;

    class Fake {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: Handler = null;
      ended = false;
      results: { isFinal: boolean; 0: { transcript: string }; length: number }[] = [];
      start() {
        state.started++;
        state.starts.push(performance.now());
        state.recs.push(this);
      }
      stop() {
        setTimeout(() => this.end(), 30);
      }
      abort() {
        setTimeout(() => {
          this.onerror?.({ error: "aborted" });
          this.end();
        }, 0);
      }
      end() {
        if (this.ended) return;
        this.ended = true;
        state.ends.push(performance.now());
        this.onend?.({});
      }
      say(text: string) {
        this.results.push({ isFinal: false, 0: { transcript: text }, length: 1 });
        this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
      }
      fail(error: string) {
        this.onerror?.({ error });
        this.end();
      }
    }
    if (m.recognition === false) {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    } else {
      w.SpeechRecognition = Fake;
      w.webkitSpeechRecognition = Fake;
    }
    if (m.micDenied) {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    }
    if (m.iphone) {
      Object.defineProperty(navigator, "userAgent", {
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      });
    }
    if (m.standalone) {
      Object.defineProperty(navigator, "standalone", { value: true });
      Object.defineProperty(navigator, "userAgent", {
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      });
    }

    const synth = {
      speaking: false,
      getVoices: () => [],
      cancel() {
        if (held.length) state.cancelled++;
        for (const u of held.splice(0)) u.onerror?.(new Event("error") as SpeechSynthesisErrorEvent);
      },
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
      speak(u: SpeechSynthesisUtterance) {
        if (u.text.trim()) state.spoken.push(u.text);
        else state.primed++;
        if (m.holdSpeech && u.text.trim()) held.push(u);
        else setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  }, mode);
}

export const live = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean }[] } }).__voice;
    return v.recs.filter((r) => !r.ended).length;
  });

export const voice = <T>(page: Page, fn: string) =>
  page.evaluate(
    `(() => { const v = window.__voice; const r = v.recs.at(-1); return ${fn}; })()`,
  ) as Promise<T>;

/** A streamed answer in the API's server-sent events, as /chat/stream passes it through. */
export function streamReply(page: Page, text: string) {
  const now = new Date().toISOString();
  const pieces = text.match(/.{1,12}/g) ?? [];
  const body = [
    ...pieces.map((p) => `event: delta\ndata: ${JSON.stringify({ text: p })}\n\n`),
    `event: done\ndata: ${JSON.stringify({
      message: { id: "m-user", role: "user", content: "asked", created_at: now },
      reply: { id: "m-reply", role: "assistant", content: text, created_at: now },
      actions: [],
    })}\n\n`,
  ].join("");
  return page.route("**/chat/stream", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body }),
  );
}
