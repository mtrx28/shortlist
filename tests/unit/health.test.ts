import { describe, expect, it } from "vitest";
import { buildHealthReport } from "@/lib/health";

describe("buildHealthReport", () => {
  it("reports ok with the app name and the given time", () => {
    const now = new Date("2026-11-17T09:30:00.000Z");
    expect(buildHealthReport(now)).toEqual({
      status: "ok",
      app: "shortlist",
      time: "2026-11-17T09:30:00.000Z",
    });
  });

  it("uses the current time when none is given", () => {
    const before = Date.now();
    const report = buildHealthReport();
    const reported = new Date(report.time).getTime();
    expect(reported).toBeGreaterThanOrEqual(before);
    expect(reported).toBeLessThanOrEqual(Date.now());
  });
});
