import { createHmac } from "node:crypto";
import { z } from "zod";

// The eLitmus verification in this project is a SIMULATION: I have no access to
// eLitmus data, so nothing here checks an ID against a real record. What is
// real is the handling: the raw pH ID is never stored, only a keyed hash.

// I do not know the real pH ID format, so this only checks it looks sane:
// 6 to 14 letters or digits (spaces and dashes are ignored).
export function normalisePhId(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export const phIdSchema = z
  .string()
  .transform(normalisePhId)
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z0-9]{6,14}$/,
        "A pH ID is 6 to 14 letters and numbers. Check it and try again.",
      ),
  );

// HMAC-SHA256 with a secret kept only on the server. A plain hash of a short ID
// could be guessed by trying every possible ID; with the secret it cannot.
export function hashPhId(phId: string, secret: string): string {
  return createHmac("sha256", secret).update(normalisePhId(phId)).digest("hex");
}

// Demo switch: when DEMO_AUTO_VERIFY=true the request is approved straight
// away. It is off unless the variable is set exactly to "true".
export function isDemoAutoVerify(): boolean {
  return process.env.DEMO_AUTO_VERIFY === "true";
}
