import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, buildAuditEntry } from "@/lib/admin/audit";
import { isAdminProfile } from "@/lib/admin/auth";
import { countByName } from "@/lib/admin/stats";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";

describe("isAdminProfile", () => {
  it("accepts an active admin", () => {
    expect(
      isAdminProfile({ role: "admin", suspended_at: null, deleted_at: null }),
    ).toBe(true);
  });

  it("rejects normal users, missing rows and unknown roles", () => {
    const base = { suspended_at: null, deleted_at: null };
    expect(isAdminProfile({ ...base, role: "user" })).toBe(false);
    expect(isAdminProfile({ ...base, role: null })).toBe(false);
    expect(isAdminProfile({ ...base, role: "Admin" })).toBe(false);
    expect(isAdminProfile({ ...base, role: "superadmin" })).toBe(false);
    expect(isAdminProfile(null)).toBe(false);
    expect(isAdminProfile(undefined)).toBe(false);
  });

  it("rejects an admin who is suspended or deleted", () => {
    expect(
      isAdminProfile({
        role: "admin",
        suspended_at: "2026-11-01T00:00:00Z",
        deleted_at: null,
      }),
    ).toBe(false);
    expect(
      isAdminProfile({
        role: "admin",
        suspended_at: null,
        deleted_at: "2026-11-01T00:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("buildAuditEntry", () => {
  it("records who did what to whom", () => {
    expect(
      buildAuditEntry({
        adminId: ADMIN,
        action: "verification_approved",
        targetType: "profile",
        targetId: TARGET,
      }),
    ).toEqual({
      admin_id: ADMIN,
      action: "verification_approved",
      target: `profile:${TARGET}`,
    });
  });

  it("accepts every listed action", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(
        buildAuditEntry({
          adminId: ADMIN,
          action,
          targetType: "profile",
          targetId: TARGET,
        }).action,
      ).toBe(action);
    }
  });

  it("refuses ids that are not UUIDs and unknown actions", () => {
    expect(() =>
      buildAuditEntry({
        adminId: "not-a-uuid",
        action: "verification_approved",
        targetType: "profile",
        targetId: TARGET,
      }),
    ).toThrow(/admin/);
    expect(() =>
      buildAuditEntry({
        adminId: ADMIN,
        action: "verification_approved",
        targetType: "profile",
        targetId: "1; drop table profiles",
      }),
    ).toThrow(/target/);
    expect(() =>
      buildAuditEntry({
        adminId: ADMIN,
        action: "delete_everything" as never,
        targetType: "profile",
        targetId: TARGET,
      }),
    ).toThrow(/action/);
  });
});

describe("countByName", () => {
  it("counts and sorts, most common first then by name", () => {
    expect(
      countByName([
        { name: "login" },
        { name: "signup" },
        { name: "login" },
        { name: "chat_opened" },
        { name: "signup" },
        { name: "login" },
      ]),
    ).toEqual([
      { name: "login", count: 3 },
      { name: "signup", count: 2 },
      { name: "chat_opened", count: 1 },
    ]);
    expect(countByName([])).toEqual([]);
  });
});
