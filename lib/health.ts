// Builds the JSON that /api/health returns. Kept separate from the route
// so it can be unit tested without starting a server.
export type HealthReport = {
  status: "ok";
  app: string;
  time: string;
};

export function buildHealthReport(now: Date = new Date()): HealthReport {
  return {
    status: "ok",
    app: "shortlist",
    time: now.toISOString(),
  };
}
