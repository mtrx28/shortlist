// Age and date-of-birth helpers. The 18+ rule is checked here (server action)
// and again in the database (see enforce_adult_dob in the schema migration).

export const MIN_AGE = 18;

export type DateParts = { year: number; month: number; day: number };

// Parses "YYYY-MM-DD" and rejects dates that do not exist (e.g. 2023-02-30).
export function parseIsoDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  const real =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

// Whole years completed on `today`, using UTC dates like the database does.
// Someone born on 29 Feb turns a year older on 1 Mar in non-leap years.
export function ageOn(dob: DateParts, today: Date = new Date()): number {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  let age = y - dob.year;
  const birthdayNotYetReached =
    m < dob.month || (m === dob.month && d < dob.day);
  if (birthdayNotYetReached) age -= 1;
  return age;
}

export function isAdult(dob: DateParts, today: Date = new Date()): boolean {
  return ageOn(dob, today) >= MIN_AGE;
}
