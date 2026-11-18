"use client";

import { useEffect, useState } from "react";
import { formatTimeLeft } from "@/lib/shortlist/time";

// "3 days 4 hours". The server sends the time it rendered at, so the first
// paint matches on the server and in the browser; after that it ticks every
// 30 seconds.
export function Countdown({
  target,
  renderedAt,
}: {
  target: string;
  renderedAt: string;
}) {
  const [now, setNow] = useState(() => new Date(renderedAt));

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return <span>{formatTimeLeft(new Date(target), now)}</span>;
}
