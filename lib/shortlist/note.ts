import { SHORTLIST_CONFIG } from "@/config/shortlist";
import {
  CONTACT_MESSAGES,
  findContactInfo,
} from "@/lib/validators/contact-info";

// The optional note that goes with "Interested". It is cleaned first (control
// characters removed, spaces tidied) and then checked. An empty note is fine
// and means "no note".

export type NoteResult =
  { ok: true; note: string | null } | { ok: false; error: string };

// True for control characters and invisible formatting characters.
function isHidden(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

// Removes those characters (line breaks and tabs become a single space) and
// squeezes repeated spaces.
export function cleanNote(raw: string): string {
  let out = "";
  for (const ch of raw) out += isHidden(ch.codePointAt(0) ?? 0) ? " " : ch;
  return out.replace(/\s+/g, " ").trim();
}

export function validateIntroNote(raw: unknown): NoteResult {
  if (raw === null || raw === undefined) return { ok: true, note: null };
  if (typeof raw !== "string")
    return { ok: false, error: "That note is not valid." };

  const note = cleanNote(raw);
  if (note === "") return { ok: true, note: null };

  const max = SHORTLIST_CONFIG.noteMaxLength;
  if (note.length > max) {
    return { ok: false, error: `Keep your note under ${max} characters.` };
  }
  const contact = findContactInfo(note);
  if (contact) return { ok: false, error: CONTACT_MESSAGES[contact] };
  return { ok: true, note };
}
