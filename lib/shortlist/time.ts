import { SHORTLIST_CONFIG } from "@/config/shortlist";

// Clock rules for intros. Pure functions: they take "now" as an argument so
// tests do not depend on the real time.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// When the intros of the drop for the week starting on this Monday (UTC,
// YYYY-MM-DD) stop being answerable: the next drop goes out then.
export function introExpiresAt(weekStart: string): Date {
  const [y, m, d] = weekStart.split("-").map(Number);
  const monday = Date.UTC(y, m - 1, d);
  return new Date(
    monday + SHORTLIST_CONFIG.introExpiryMinutesAfterWeekStart * MINUTE,
  );
}

export function isIntroExpired(weekStart: string, now: Date): boolean {
  return now.getTime() >= introExpiresAt(weekStart).getTime();
}

// The next time the weekly drop goes out: the next Sunday at the configured
// time, strictly after "now".
export function nextDropAt(now: Date): Date {
  const { dropHourUtc, dropMinuteUtc } = SHORTLIST_CONFIG;
  const daysToSunday = (7 - now.getUTCDay()) % 7;
  let at = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysToSunday,
    dropHourUtc,
    dropMinuteUtc,
  );
  if (at <= now.getTime()) at += 7 * DAY;
  return new Date(at);
}

// "3 days 4 hours", "5 hours 20 min", "12 min", "under a minute".
// Shows the two biggest units that are not zero.
export function formatTimeLeft(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);

  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days > 0) {
    return hours > 0
      ? `${plural(days, "day")} ${plural(hours, "hour")}`
      : plural(days, "day");
  }
  if (hours > 0) {
    return minutes > 0
      ? `${plural(hours, "hour")} ${minutes} min`
      : plural(hours, "hour");
  }
  if (minutes > 0) return `${minutes} min`;
  return "under a minute";
}
