import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "@/lib/cron-auth";

const runDropJob = vi.fn();
const createAdminClient = vi.fn();
vi.mock("@/lib/matching/drop-job", () => ({
  runDropJob: (...args: unknown[]) => runDropJob(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));

const SECRET = "a-long-random-secret";

describe("isCronAuthorized", () => {
  it("accepts the right secret", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing or malformed header", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized(undefined, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false); // no "Bearer "
    expect(isCronAuthorized("Basic " + SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized("Bearer ", SECRET)).toBe(false);
  });

  it("rejects a wrong secret, including one that is a prefix or longer", () => {
    expect(isCronAuthorized("Bearer wrong", SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(
      false,
    );
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("rejects everything when the secret is not configured", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}`, "")).toBe(false);
  });
});

describe("POST /api/cron/drop", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    runDropJob.mockReset();
    createAdminClient.mockReset();
    createAdminClient.mockReturnValue({});
    runDropJob.mockResolvedValue({
      status: "created",
      weekStart: "2026-11-16",
      stats: { introsCreated: 3 },
    });
  });

  const call = async (authorization?: string) => {
    const { POST } = await import("@/app/api/cron/drop/route");
    return POST(
      new Request("http://localhost/api/cron/drop", {
        method: "POST",
        headers: authorization ? { authorization } : {},
      }),
    );
  };

  it("returns 401 and does nothing without a header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect(runDropJob).not.toHaveBeenCalled();
  });

  it("returns 401 for the wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(runDropJob).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not set, even if the caller guesses empty", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer anything")).status).toBe(401);
    expect(runDropJob).not.toHaveBeenCalled();
  });

  it("runs the drop for the right secret and returns aggregate stats only", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "created",
      weekStart: "2026-11-16",
      stats: { introsCreated: 3 },
    });
    expect(runDropJob).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the service key is missing and 500 when the drop fails", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    createAdminClient.mockReturnValue(null);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    createAdminClient.mockReturnValue({});
    runDropJob.mockRejectedValue(new Error("boom"));
    const failed = await call(`Bearer ${SECRET}`);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("boom");
  });
});

describe("POST /api/cron/keepalive", () => {
  const call = async (authorization?: string) => {
    const { POST } = await import("@/app/api/cron/keepalive/route");
    return POST(
      new Request("http://localhost/api/cron/keepalive", {
        method: "POST",
        headers: authorization ? { authorization } : {},
      }),
    );
  };
  const clientReturning = (error: unknown) => ({
    from: () => ({
      select: () => ({ limit: () => Promise.resolve({ error }) }),
    }),
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    createAdminClient.mockReset();
  });

  it("needs the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    createAdminClient.mockReturnValue(clientReturning(null));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("answers 200 when the database query works and 503 when it does not", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    createAdminClient.mockReturnValue(clientReturning(null));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    createAdminClient.mockReturnValue(clientReturning({ message: "down" }));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
