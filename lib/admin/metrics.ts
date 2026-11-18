// The numbers for the admin metrics cards. The database function
// `admin_metrics` returns raw totals (no rows about people); this file turns
// them into the cards: it checks the shape and works out the percentages.

export type RawMetrics = {
  members: number;
  verified: number;
  active_chats: number;
  intros_delivered: number;
  replies_owed: number;
  replies_sent: number;
  kept_chats: number;
  closed_chats: number;
  expired_chats: number;
  plus_members: number;
  paid_orders: number;
  revenue_paise: number;
};

export type MetricCard = {
  id: string;
  label: string;
  value: string;
  note?: string;
};

const KEYS: (keyof RawMetrics)[] = [
  "members",
  "verified",
  "active_chats",
  "intros_delivered",
  "replies_owed",
  "replies_sent",
  "kept_chats",
  "closed_chats",
  "expired_chats",
  "plus_members",
  "paid_orders",
  "revenue_paise",
];

// Accepts what the database returned (jsonb, so numbers can arrive as
// strings from some drivers) and returns clean non-negative whole numbers, or
// null if it is not an object at all.
export function parseRawMetrics(input: unknown): RawMetrics | null {
  if (typeof input !== "object" || input === null) return null;
  const source = input as Record<string, unknown>;
  const out = {} as Record<string, number>;
  for (const key of KEYS) {
    const n = Number(source[key] ?? 0);
    out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out as RawMetrics;
}

// "62%" or "-" when there is nothing to divide by (no invented numbers).
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "-";
  return `${Math.round((part / whole) * 100)}%`;
}

export function rupees(paise: number): string {
  const rupeesValue = paise / 100;
  return `Rs ${rupeesValue.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

export function buildMetricCards(raw: RawMetrics): MetricCard[] {
  const decided = raw.kept_chats + raw.closed_chats;
  return [
    { id: "members", label: "Members", value: String(raw.members) },
    {
      id: "verified",
      label: "Verified via eLitmus",
      value: String(raw.verified),
      note: percent(raw.verified, raw.members) + " of members",
    },
    {
      id: "active-chats",
      label: "Active chats",
      value: String(raw.active_chats),
      note: "open or kept",
    },
    {
      id: "intros",
      label: "Intros delivered",
      value: String(raw.intros_delivered),
    },
    {
      id: "reply-rate",
      label: "Reply rate within 72h",
      value: percent(raw.replies_sent, raw.replies_owed),
      note: `${raw.replies_sent} of ${raw.replies_owed} owed replies`,
    },
    {
      id: "keep-close",
      label: "Keep vs close",
      value: `${raw.kept_chats} / ${raw.closed_chats}`,
      note:
        decided > 0
          ? `${percent(raw.kept_chats, decided)} kept`
          : "no decisions yet",
    },
    { id: "plus", label: "Plus members", value: String(raw.plus_members) },
    {
      id: "revenue",
      label: "Revenue (test mode)",
      value: rupees(raw.revenue_paise),
      note: `${raw.paid_orders} paid order${raw.paid_orders === 1 ? "" : "s"}, test money`,
    },
  ];
}
