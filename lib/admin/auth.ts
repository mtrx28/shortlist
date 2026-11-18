// Who counts as an admin. A pure function so the rule is easy to test; the
// server-side guard that uses it is in require-admin.ts.

export type AdminCheckRow = {
  role: string | null;
  suspended_at: string | null;
  deleted_at: string | null;
} | null;

// An admin must have the admin role and must not be suspended or deleted.
// This matches the database's own is_admin() function.
export function isAdminProfile(row: AdminCheckRow | undefined): boolean {
  if (!row) return false;
  return row.role === "admin" && !row.suspended_at && !row.deleted_at;
}
