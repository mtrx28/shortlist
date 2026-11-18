// Small pure helpers for the orders numbers on the admin dashboard and the
// /admin/orders list.

export type OrderRow = {
  id: string;
  user_id: string | null;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  plan: string;
  amount_paise: number;
  status: "created" | "paid" | "failed";
  provider: string;
  created_at: string;
  paid_at: string | null;
  revoked_at: string | null;
};

export type OrderStats = {
  total: number;
  paid: number;
  abandoned: number; // created, never paid
  failed: number;
  revoked: number;
  revenuePaise: number; // paid orders only (test money, before GST and fees)
  paidUsers: number; // different people with at least one paid order
  activeUsers: number;
  conversionPercent: number | null; // paid users / active users
};

export function summarizeOrders(
  rows: OrderRow[],
  activeUsers: number,
): OrderStats {
  const paidRows = rows.filter((r) => r.status === "paid");
  const paidUsers = new Set(
    paidRows.flatMap((r) => (r.user_id ? [r.user_id] : [])),
  ).size;
  return {
    total: rows.length,
    paid: paidRows.length,
    abandoned: rows.filter((r) => r.status === "created").length,
    failed: rows.filter((r) => r.status === "failed").length,
    revoked: paidRows.filter((r) => r.revoked_at !== null).length,
    revenuePaise: paidRows.reduce((sum, r) => sum + r.amount_paise, 0),
    paidUsers,
    activeUsers,
    conversionPercent:
      activeUsers > 0
        ? Math.round((paidUsers / activeUsers) * 1000) / 10
        : null,
  };
}

// "order_Pq3xk2ab91Zc" -> "order_P...91Zc". Ids are shown to admins in part
// only: enough to find an order in the payment dashboard, not enough to be
// useful if a screenshot leaks.
export function maskId(id: string | null): string {
  if (!id) return "-";
  if (id.length <= 10) return `${id.slice(0, 2)}...`;
  return `${id.slice(0, 7)}...${id.slice(-4)}`;
}
