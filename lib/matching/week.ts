// Week helpers. A "week" is identified by its Monday (UTC) as YYYY-MM-DD.

const DAY_MS = 24 * 3600 * 1000;

function toUtcMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// The Monday a drop run at `now` belongs to. The weekly drop goes out on
// Sunday evening (India time), which is the start of the new week for users,
// so a run on Sunday counts as next week's drop. Monday to Saturday belong to
// their own week. Adding one day before taking the Monday does exactly that.
export function dropWeekStart(now: Date): string {
  const shifted = new Date(now.getTime() + DAY_MS);
  const dayOfWeek = shifted.getUTCDay(); // 0 = Sunday
  const back = (dayOfWeek + 6) % 7; // days since Monday
  const monday = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - back,
  );
  return new Date(monday).toISOString().slice(0, 10);
}

// Whole weeks from `earlier` back to `later`. Positive when `earlier` is
// before `later`.
export function weeksBetween(earlier: string, later: string): number {
  return Math.round((toUtcMs(later) - toUtcMs(earlier)) / (7 * DAY_MS));
}

// The Monday `weeks` weeks before the given Monday.
export function weeksBefore(day: string, weeks: number): string {
  return new Date(toUtcMs(day) - weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}
