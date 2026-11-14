// Michael's check in (#189): a few questions about the day, one at a time (rule in
// packages/shared/src/voice.ts, #192). SAMPLE questions, Brand's copy from #189, until the check in
// API (#187) exists. TODO(#187): read the day's questions from the API.

export type Answer = "yes" | "no" | number | string;

export type Question = {
  id: string;
  text: string;
  kind: "scale" | "yesno";
  /** Asked only when the answer to this question is "no". */
  ifNo?: Question;
};

export const OPENING = "Three questions about today. About a minute.";
export const AFTER = "Noted. I'll use it in tomorrow's plan.";
export const DONE = "That's all for today. Sleep well.";

export const SAMPLE_QUESTIONS: Question[] = [
  { id: "training", text: "Gym, 20:30 to 22:30. How did it go? 1 to 5.", kind: "scale" },
  {
    id: "meeting",
    text: "Did the 15:00 go the way you wanted?",
    kind: "yesno",
    ifNo: { id: "meeting-sleep", text: "You slept 5h 10. Did that play a part?", kind: "yesno" },
  },
  { id: "phone", text: "Your phone opened 9 times in the 10:30 block. Focus, 1 to 5?", kind: "scale" },
];

/** The questions still to ask, in order, with follow ups where the answers call for them. */
export function queue(questions: Question[], answers: Record<string, Answer>): Question[] {
  const out: Question[] = [];
  for (const q of questions) {
    out.push(q);
    if (q.ifNo && answers[q.id] === "no") out.push(q.ifNo);
  }
  return out.slice(0, 5);
}
