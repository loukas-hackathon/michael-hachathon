// Drives and the traffic plan (#157). Travel events come from the contract (source maps, type
// travel, TravelData, #115); the whole day plan (#155) and parking (#156) have no shapes yet, so
// these local types carry them, with sample data, until they land.

/** One planned drive, drawn on the Timeline: traffic is the minutes above an empty road. */
export type Drive = {
  start: string;
  end: string;
  to: string;
  minutes: number;
  freeFlowMinutes: number;
  parking?: Parking | null;
};

export type Parking = { hard: boolean; carPark: string; walkMinutes: number; url: string };

/** Michael's proposal for the day's drives: move an own block past the rush (#155). */
export type TravelPlan = {
  block: string;
  before: { departAt: string; minutes: number; trafficMinutes: number };
  after: { departAt: string; minutes: number; trafficMinutes: number; blockStart: string };
  wonMinutes: number;
  undoUntil: string;
  parking?: Parking | null;
};

/** TravelData (#115) as a Drive, for the travel events the API stores. */
export function driveFromEvent(e: {
  start_at: string;
  end_at: string | null;
  data: Record<string, unknown>;
}): Drive | null {
  const d = e.data as { to?: { label?: string }; minutes?: number; free_flow_minutes?: number };
  if (!e.end_at || typeof d.minutes !== "number" || typeof d.free_flow_minutes !== "number") return null;
  return {
    start: e.start_at,
    end: e.end_at,
    to: d.to?.label ?? "the next place",
    minutes: d.minutes,
    freeFlowMinutes: d.free_flow_minutes,
  };
}
