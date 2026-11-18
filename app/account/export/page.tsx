import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SAFETY_CONFIG } from "@/config/safety";
import { requireSession } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Download my data | Shortlist" };

export default async function ExportPage() {
  await requireSession();
  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Download my data
      </h1>
      <p className="text-sm">You get one JSON file with:</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>your profile and your answers (including your date of birth);</li>
        <li>your consents, with versions and dates;</li>
        <li>
          the introductions you were shown, and your answers and notes, but not
          who the other people were;
        </li>
        <li>
          your chats, with only the messages <em>you</em> wrote;
        </li>
        <li>reports you filed, how many people you blocked, your orders.</li>
      </ul>
      <p className="text-muted-foreground text-sm">
        It never contains other people&apos;s names, photos, messages or
        answers. You can download it {SAFETY_CONFIG.exportsPerDay} times a day.
      </p>
      <form action="/account/export/download" method="post">
        <Button type="submit">Download my data (JSON)</Button>
      </form>
      <p className="text-sm">
        <Link href="/account/privacy" className="underline">
          Back to privacy and consents
        </Link>
      </p>
    </section>
  );
}
