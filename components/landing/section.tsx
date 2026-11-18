import type { ReactNode } from "react";

// A titled block of the landing page. The id lets the page link to it.
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-4">
      <h2
        id={`${id}-title`}
        className="text-2xl font-semibold tracking-tight text-balance"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
