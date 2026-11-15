import { RULES } from "./context";
import { capIds } from "./util";

export interface Detector<T> {
  status: "ok" | "not_enough_data";
  reason: string | null;
  minimum: string;
  summary: string | null;
  evidence: string[];
  data: T | null;
}

export const found = <T>(
  minimum: string,
  summary: string,
  evidence: Iterable<string>,
  data: T,
): Detector<T> => ({
  status: "ok",
  reason: null,
  minimum,
  summary,
  evidence: capIds(evidence, RULES.evidenceCap),
  data,
});

/** Too little data: no number, no summary, and a reason that says what is missing ("Not enough data yet: ..."). */
export const notEnough = <T>(minimum: string, missing: string): Detector<T> => ({
  status: "not_enough_data",
  reason: `Not enough data yet: ${missing}`,
  minimum,
  summary: null,
  evidence: [],
  data: null,
});
