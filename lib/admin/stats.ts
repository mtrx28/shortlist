// Small pure helpers for the admin dashboard.

// Counts events by name, most common first (ties sorted by name).
export function countByName(
  rows: { name: string }[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
