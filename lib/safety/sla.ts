import { SAFETY_CONFIG } from "@/config/safety";

// How old a report is, and whether it is late against our own DRAFT targets
// (see config/safety.ts). Pure functions, so the rules are easy to test.

export type SlaReport = {
  status: "open" | "ack" | "actioned" | "dismissed";
  created_at: string;
  ack_at: string | null;
  resolved_at: string | null;
};

export type SlaState = "ok" | "ack_overdue" | "resolve_overdue" | "done";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// "3 h", "2 d 4 h" and so on. Never negative.
export function ageText(from: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(from).getTime());
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h`;
  return `${Math.floor(ms / 60000)} min`;
}

// ok               nothing is late
// ack_overdue      still "open" more than ackWithinHours after it came in
// resolve_overdue  not actioned or dismissed resolveWithinDays after it came in
// done             already actioned or dismissed
export function slaState(report: SlaReport, now: Date): SlaState {
  if (report.status === "actioned" || report.status === "dismissed") {
    return "done";
  }
  const age = now.getTime() - new Date(report.created_at).getTime();
  if (age > SAFETY_CONFIG.resolveWithinDays * DAY) return "resolve_overdue";
  if (report.status === "open" && age > SAFETY_CONFIG.ackWithinHours * HOUR) {
    return "ack_overdue";
  }
  return "ok";
}

export function slaText(state: SlaState): string {
  switch (state) {
    case "ack_overdue":
      return `Not acknowledged within ${SAFETY_CONFIG.ackWithinHours} h (draft target)`;
    case "resolve_overdue":
      return `Open longer than ${SAFETY_CONFIG.resolveWithinDays} days (draft target)`;
    case "done":
      return "Finished";
    default:
      return "Within draft targets";
  }
}
