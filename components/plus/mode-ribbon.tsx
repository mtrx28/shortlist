// The banner that says no real money is involved. It shows on every payment
// page whenever the payment mode is the fake checkout or Razorpay's test mode.
export function ModeRibbon({
  ribbon,
  detail,
}: {
  ribbon: string | null;
  detail: string;
}) {
  if (!ribbon) return null;
  return (
    <div
      role="note"
      aria-label="Payment mode"
      data-testid="mode-ribbon"
      className="rounded-lg border border-amber-500 bg-amber-100 p-3 text-sm text-amber-950"
    >
      <p className="font-semibold tracking-wide">{ribbon}</p>
      <p>{detail}</p>
    </div>
  );
}
