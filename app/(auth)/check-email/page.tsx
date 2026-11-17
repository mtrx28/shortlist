export const metadata = { title: "Check your email | Shortlist" };

export default function CheckEmailPage() {
  return (
    <section className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Check your email
      </h1>
      <p className="text-sm">
        If the address can be used, we have sent a confirmation link. Open it to
        finish creating your account, then log in.
      </p>
    </section>
  );
}
