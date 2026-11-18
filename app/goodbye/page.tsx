import Link from "next/link";

export const metadata = { title: "Account deleted | Shortlist" };

export default function GoodbyePage() {
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Your account has been deleted
      </h1>
      <p className="text-muted-foreground text-sm">
        Your profile, photos, chats and messages are gone. Thank you for trying
        Shortlist. You are welcome to sign up again whenever you like.
      </p>
      <Link href="/" className="text-sm underline">
        Back to the start
      </Link>
    </section>
  );
}
