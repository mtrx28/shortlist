// What the /demo evaluator guide says. The logins match the people in
// scripts/seed/demo-data.ts (a unit test checks they still exist there).

export const DEMO_EMAIL_DOMAIN = "demo.shortlist.test";

export type DemoLogin = {
  handle: string;
  who: string;
  shows: string;
};

export const DEMO_LOGINS: DemoLogin[] = [
  {
    handle: "priya",
    who: "Woman, Bengaluru",
    shows: "A full shortlist of three and a chat in progress with Rohan.",
  },
  {
    handle: "arjun",
    who: "Man, Pune",
    shows:
      "A chat about to run out of time (Sneha wrote, he has not replied) and a woman who already showed interest.",
  },
  {
    handle: "ananya",
    who: "Woman, Bengaluru, has Plus",
    shows:
      "Plus: 5 chats, 5 intros, the full why-we-matched breakdown and a second look.",
  },
  {
    handle: "neha",
    who: "New member, Hyderabad",
    shows: "A finished profile with nothing yet: the empty states.",
  },
  {
    handle: "admin",
    who: "Admin",
    shows:
      "Dashboard metrics, verification approvals, run the weekly drop, reports, orders.",
  },
];

export function demoEmail(handle: string): string {
  return `${handle}@${DEMO_EMAIL_DOMAIN}`;
}
