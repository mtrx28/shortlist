import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Forgot password | Shortlist" };

export default function ForgotPasswordPage() {
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="text-muted-foreground text-sm">
        Enter your email and we will send you a link.
      </p>
      <ForgotPasswordForm />
    </section>
  );
}
