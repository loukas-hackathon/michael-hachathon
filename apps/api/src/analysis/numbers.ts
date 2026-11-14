import type { CoachAnswer } from "./output";

// The number guard: every number Michael says must come from what he was given.
//
// The moment card has the strict form of this rule (moments/phrase.ts: every digit run of the line
// must appear in the facts). A brief allows a little more, because the coach instructions let the
// model convert what it is given: minutes to hours ("135 minutes" may read "2h 15" or "2.3 hours"),
// hours to minutes, a share to a percentage. Nothing else is derived: a sum or a difference that is
// not in the inputs counts as invented, so the model is pushed to quote the brief's own totals.
//
// Clock times are their own tokens ("07:00"). A time is known when the inputs hold it, or when
// the answer's own action proposes it (the new time of a block is Michael's offer, not a fact).

const TIME = /\b([01]?\d|2[0-4]):([0-5]\d)\b/g;
const NUMBER = /\d+(?:\.\d+)?/g;

/** "7:00" and "07:00" are the same time. */
const normTime = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
/** "07", "7" and "7.0" are the same number. */
const normNumber = (n: number) => String(Math.round(n * 100) / 100);

function tokens(text: string): { times: string[]; numbers: number[] } {
  const times: string[] = [];
  const bare = text.replace(TIME, (_, h: string, m: string) => {
    times.push(normTime(h, m));
    return " ";
  });
  const numbers = (bare.match(NUMBER) ?? []).map(Number).filter(Number.isFinite);
  return { times, numbers };
}

export interface KnownNumbers {
  numbers: Set<string>;
  times: Set<string>;
}

/** Everything a line may quote, from the texts the model was given. */
export function knownNumbers(sources: string[]): KnownNumbers {
  const numbers = new Set<string>(["0", "1"]);
  const times = new Set<string>();
  const add = (n: number) => numbers.add(normNumber(n));
  for (const source of sources) {
    const t = tokens(source);
    for (const time of t.times) {
      times.add(time);
      // "the 18:00 block" may also be "the 18 o'clock block".
      add(Number(time.slice(0, 2)));
    }
    for (const n of t.numbers) {
      add(n);
      // Minutes to hours: whole, one decimal, nearest half, and "2h 15".
      add(Math.round(n / 60));
      add(Math.round((n / 60) * 10) / 10);
      add(Math.round((n / 60) * 2) / 2);
      add(Math.floor(n / 60));
      add(n % 60);
      // Hours to minutes (a sleep target of 7.5 hours is 450 minutes).
      if (n <= 24) add(n * 60);
      // A share to a percentage.
      if (n > 0 && n < 1) add(Math.round(n * 100));
    }
  }
  return { numbers, times };
}

/** The numbers and times in `text` that `known` does not hold, as they were written. */
export function inventedNumbers(text: string, known: KnownNumbers, extraTimes: string[] = []): string[] {
  const t = tokens(text);
  const extra = new Set(extraTimes.map((x) => tokens(x).times[0] ?? x));
  return [
    ...t.times.filter((time) => !known.times.has(time) && !extra.has(time)),
    ...t.numbers.filter((n) => !known.numbers.has(normNumber(n))).map(normNumber),
  ];
}

export interface NumberViolation {
  where: string;
  rule: string;
  found: string;
}

export const NUMBER_RULE =
  "every number and time must be in the brief or the findings (minutes may be converted to hours, nothing else may be worked out)";

/**
 * The guard on a whole answer: the summary, the question, each title and rationale. The times an
 * action of the same answer proposes are allowed in the copy.
 */
export function numberViolations(answer: CoachAnswer, known: KnownNumbers): NumberViolation[] {
  const proposed = answer.recommendations.flatMap((r) =>
    r.action ? [r.action.start, r.action.end].filter((x): x is string => typeof x === "string") : [],
  );
  const fields: [string, string | null][] = [
    ["summary", answer.summary],
    ["question", answer.question],
    ...answer.recommendations.flatMap((r, i): [string, string][] => [
      [`recommendations[${i}].title`, r.title],
      [`recommendations[${i}].rationale`, r.rationale],
    ]),
  ];
  return fields.flatMap(([where, text]) => {
    if (!text) return [];
    const invented = inventedNumbers(text, known, proposed);
    return invented.length > 0 ? [{ where, rule: NUMBER_RULE, found: invented.join(", ") }] : [];
  });
}
