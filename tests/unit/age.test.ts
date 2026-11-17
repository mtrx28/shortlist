import { describe, expect, it } from "vitest";
import { ageOn, isAdult, parseIsoDate } from "@/lib/age";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dob = (iso: string) => parseIsoDate(iso)!;

describe("parseIsoDate", () => {
  it("accepts a real date", () => {
    expect(parseIsoDate("2000-02-29")).toEqual({
      year: 2000,
      month: 2,
      day: 29,
    });
  });
  it("rejects dates that do not exist", () => {
    expect(parseIsoDate("2023-02-29")).toBeNull();
    expect(parseIsoDate("2023-13-01")).toBeNull();
    expect(parseIsoDate("2023-04-31")).toBeNull();
  });
  it("rejects other formats", () => {
    expect(parseIsoDate("01/02/2000")).toBeNull();
    expect(parseIsoDate("2000-1-2")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });
});

describe("ageOn", () => {
  it("is 17 the day before the 18th birthday", () => {
    expect(ageOn(dob("2008-06-15"), day("2026-06-14"))).toBe(17);
    expect(isAdult(dob("2008-06-15"), day("2026-06-14"))).toBe(false);
  });
  it("is 18 on the exact 18th birthday", () => {
    expect(ageOn(dob("2008-06-15"), day("2026-06-15"))).toBe(18);
    expect(isAdult(dob("2008-06-15"), day("2026-06-15"))).toBe(true);
  });
  it("handles a birthday later in the year than today's month", () => {
    expect(ageOn(dob("2000-12-31"), day("2026-01-01"))).toBe(25);
  });
  it("treats a 29 Feb birthday as reached on 1 Mar in a non-leap year", () => {
    const born = dob("2008-02-29");
    expect(ageOn(born, day("2026-02-28"))).toBe(17);
    expect(ageOn(born, day("2026-03-01"))).toBe(18);
  });
  it("reaches a 29 Feb birthday on 29 Feb in a leap year", () => {
    const born = dob("2004-02-29");
    expect(ageOn(born, day("2028-02-28"))).toBe(23);
    expect(ageOn(born, day("2028-02-29"))).toBe(24);
  });
  it("is 0 for a newborn and never negative-looking for today", () => {
    expect(ageOn(dob("2026-11-17"), day("2026-11-17"))).toBe(0);
  });
});
