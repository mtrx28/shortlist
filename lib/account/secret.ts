// The secret mixed into the hash that identifies a deleted person in the
// small safety record. Server only. Falls back to the pH hash secret so one
// existing secret is enough; refuses (returns null) if neither is set or it is
// too short, because an unsalted hash of a user id would be easy to link back.
export function safetyHashSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.SAFETY_HASH_SECRET || env.ELITMUS_HASH_SECRET || "";
  return secret.length >= 16 ? secret : null;
}
