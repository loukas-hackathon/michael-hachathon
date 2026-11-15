// Standing instructions: rules Michael plans around, not goals ("Keep Sundays clear", "Home by 21:00").
// Mirrors the shape the build session is adding as /v1/instructions (#131); switch to the shared
// types once they land. Quiet hours stay in the profile (GET/PUT /v1/profile).

export type InstructionKind = "clear_day" | "home_by" | "quiet_hours" | "custom";

export type Instruction = {
  id: string;
  text: string;
  kind: InstructionKind;
  /** 0 = Sunday. */
  days?: number[];
  time?: string;
  end_time?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type InstructionInput = Omit<Instruction, "id" | "created_at" | "updated_at">;

const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function same(a: number[], b: number[]) {
  return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
}

/** "every day", "on weekdays", "at weekends", "on Sundays", "on Mon, Wed and Fri". */
export function daysPhrase(days: number[] | undefined, { plural = true } = {}) {
  const d = days?.length ? days : [0, 1, 2, 3, 4, 5, 6];
  if (d.length === 7) return "every day";
  if (same(d, [1, 2, 3, 4, 5])) return "on weekdays";
  if (same(d, [0, 6])) return "at weekends";
  if (d.length === 1) return `on ${NAMES[d[0] as number]}${plural ? "s" : ""}`;
  const order = [...d].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => SHORT[x]);
  return `on ${order.slice(0, -1).join(", ")} and ${order.at(-1)}`;
}

/** The sentence a structured instruction reads as. Custom ones are the user's own words. */
export function instructionText(i: Pick<Instruction, "kind" | "days" | "time" | "end_time" | "text">) {
  switch (i.kind) {
    case "clear_day": {
      const d = i.days ?? [0];
      if (same(d, [0, 6])) return "Keep weekends clear";
      if (d.length === 1) return `Keep ${NAMES[d[0] as number]}s clear`;
      return `Keep ${daysPhrase(d).replace(/^on /, "")} clear`;
    }
    case "home_by":
      return `Home by ${i.time ?? "21:00"} ${daysPhrase(i.days)}`;
    case "quiet_hours":
      // About booking, not nudges: quiet hours (the profile) are the no nudges window.
      return `Never book ${i.time ?? "22:00"} to ${i.end_time ?? "07:00"}`;
    default:
      return i.text;
  }
}

/**
 * One tap house rules (Manolis, #190): offered on You under Standing instructions until the user
 * has them. Picked by index on the server, so the browser can only ask for one of these.
 */
export const HOUSE_RULES: InstructionInput[] = (
  [
    { kind: "clear_day", days: [0], text: "", active: true },
    { kind: "clear_day", days: [6], text: "", active: true },
    { kind: "home_by", days: [1, 2, 3, 4, 5], time: "19:00", text: "", active: true },
  ] satisfies InstructionInput[]
).map((r) => ({ ...r, text: instructionText(r) }));
