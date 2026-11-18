import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin | Shortlist",
  robots: { index: false, follow: false },
};

// The layout checks the role so non-admins never see the nav. It is NOT the
// only check: each admin page and action does its own (see require-admin.ts).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <nav
        aria-label="Admin"
        className="flex flex-wrap items-center gap-4 border-b pb-3 text-sm"
      >
        <span className="font-semibold">Admin</span>
        <Link href="/admin" className="underline-offset-4 hover:underline">
          Dashboard
        </Link>
        <Link
          href="/admin/verifications"
          className="underline-offset-4 hover:underline"
        >
          Verifications
        </Link>
        <Link href="/admin/drop" className="underline-offset-4 hover:underline">
          Weekly drop
        </Link>
        <Link
          href="/home"
          className="text-muted-foreground ml-auto underline-offset-4 hover:underline"
        >
          Back to the app
        </Link>
      </nav>
      {children}
    </div>
  );
}
