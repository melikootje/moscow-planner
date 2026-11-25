export type Bucket = "must" | "should" | "could" | "wont";
export type Part = "morning" | "afternoon" | "evening" | "night";

export const BUCKETS: Bucket[] = ["must", "should", "could", "wont"];
export const PARTS: Part[] = ["morning", "afternoon", "evening", "night"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  must: "Must",
  should: "Should",
  could: "Could",
  wont: "Won't",
};
export const BUCKET_HINT: Record<Bucket, string> = {
  must: "Fails the day if skipped",
  should: "Important, not vital",
  could: "Nice if time allows",
  wont: "Not today",
};
export const BUCKET_KEY: Record<Bucket, string> = { must: "M", should: "S", could: "C", wont: "W" };
export const PART_LABEL: Record<Part, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export interface Task {
  id: string;
  title: string;
  bucket: Bucket;
  part: Part;
  /** Estimated minutes. 0 means no estimate. */
  minutes: number;
  done: boolean;
  created: number;
}

export interface Settings {
  /** Time budget per day part, in minutes. */
  budgets: Record<Part, number>;
  /** Start of each day part as "HH:MM". Night wraps past midnight. */
  starts: Record<Part, string>;
  /** Recommended maximum share of planned time spent on Musts, in percent. */
  mustCap: number;
}

export interface PlannerState {
  version: 1;
  settings: Settings;
  /** Tasks keyed by ISO date (YYYY-MM-DD). */
  days: Record<string, Task[]>;
}
