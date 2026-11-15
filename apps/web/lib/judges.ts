// The judges' login (README "Try it"): one published email and password that opens the demo week,
// exactly like "See the demo week". It never signs in to the demo account itself: it hands out a
// private demo visitor id, so a judge's taps never change the shared week used on stage.
export const JUDGE_EMAIL = "judges@michael.app";
export const JUDGE_PASSWORD = "OnYourSide2026";

export const isJudgeLogin = (email: string, password: string): boolean =>
  email.trim().toLowerCase() === JUDGE_EMAIL && password === JUDGE_PASSWORD;
