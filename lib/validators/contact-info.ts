// Spots contact details in free text: links, email addresses and phone
// numbers. Used for the short note that goes with "Interested" (where they
// are not allowed) and, later, for the warning on a first chat message. It is
// a simple check, not a guarantee: someone determined can write a number out
// in words. The point is to stop the easy cases and nudge people to keep
// things inside the app until they trust each other.

export type ContactKind = "link" | "email" | "phone" | "handle";

const LINK =
  /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|in|co|net|org|io|me|app|ly|gl|link|xyz)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// An "@name" that is not part of an email, like an Instagram handle.
const HANDLE = /(^|\s)@[a-z0-9._]{3,}/i;

// Digits in a row, allowing spaces, dashes, dots and brackets between them.
// Eight or more digits counts as a phone number.
function hasPhoneNumber(text: string): boolean {
  const runs = text.match(/[+\d][\d\s().-]{5,}\d/g) ?? [];
  return runs.some((run) => run.replace(/\D/g, "").length >= 8);
}

export function findContactInfo(text: string): ContactKind | null {
  if (EMAIL.test(text)) return "email";
  if (LINK.test(text)) return "link";
  if (hasPhoneNumber(text)) return "phone";
  if (HANDLE.test(text)) return "handle";
  return null;
}

export const CONTACT_MESSAGES: Record<ContactKind, string> = {
  link: "Please leave links out for now.",
  email: "Please leave email addresses out for now.",
  phone: "Please leave phone numbers out for now.",
  handle: "Please leave social media handles out for now.",
};
