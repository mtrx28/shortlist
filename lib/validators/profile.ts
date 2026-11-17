import { z } from "zod";
import {
  BATCH_YEARS,
  CITIES,
  COLLEGE_TIERS,
  GENDERS,
  INTENTS,
  INTERESTS,
  MAX_INTERESTS,
  MIN_INTERESTS,
} from "@/config/profile-options";
import {
  PROMPTS,
  PROMPT_ANSWER_MAX,
  PROMPT_ANSWER_MIN,
  PROMPT_COUNT,
} from "@/config/prompts";
import {
  DEAL_BREAKER_COUNT,
  VALUES_QUESTIONS,
} from "@/config/values-questions";
import { phIdSchema } from "@/lib/elitmus";
import { isOwnPhotoPath, MAX_PHOTOS } from "@/lib/photos";

// One validator per onboarding step. The server actions run these on every
// save, so the browser cannot skip a rule. The same schemas are used by the
// profile edit page.

// HTML forms send a repeated field (checkboxes) as several entries, and a
// single ticked box as one string. This turns the form into a plain object
// where those fields are always arrays.
export function formToObject(
  form: FormData,
  arrayFields: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    out[key] = arrayFields.includes(key) ? form.getAll(key) : form.get(key);
  }
  for (const field of arrayFields) out[field] ??= [];
  return out;
}

// z.enum wants a non-empty tuple; our lists are plain arrays.
const values = <T extends readonly string[]>(list: T) =>
  list as unknown as [string, ...string[]];

// ---------------------------------------------------------------------------
// Step 1: basics
// ---------------------------------------------------------------------------
export const BASICS_ARRAY_FIELDS = ["interestedIn"];

export const basicsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Tell us what to call you.")
    .max(50, "Keep it under 50 characters."),
  gender: z.enum(values(GENDERS.map((g) => g.value)), "Pick one option."),
  interestedIn: z
    .array(z.enum(values(GENDERS.map((g) => g.value))))
    .min(1, "Pick at least one option.")
    .max(3),
  city: z.enum(values(CITIES), "Pick your city from the list."),
  intent: z.enum(values(INTENTS.map((i) => i.value)), "Pick one option."),
  batchYear: z.coerce
    .number("Pick your batch year.")
    .int()
    .refine(
      (y) => (BATCH_YEARS as readonly number[]).includes(y),
      `Batch year must be between ${BATCH_YEARS[0]} and ${BATCH_YEARS[BATCH_YEARS.length - 1]}.`,
    ),
  occupation: z
    .string()
    .trim()
    .min(2, "Tell us what you do, for example: Software engineer.")
    .max(100, "Keep it under 100 characters."),
  // Optional: an empty choice is stored as null.
  collegeTier: z
    .enum(values(COLLEGE_TIERS.map((t) => t.value)))
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

// ---------------------------------------------------------------------------
// Step 2: values questions. Field names are q_<id> for answers and the
// checkbox "dealBreakers" for the two flagged questions.
// ---------------------------------------------------------------------------
export const VALUES_ARRAY_FIELDS = ["dealBreakers"];

const answerShape = Object.fromEntries(
  VALUES_QUESTIONS.map((q) => [
    `q_${q.id}`,
    z.enum(values(q.options.map((o) => o.id)), "Pick an answer."),
  ]),
);

export const valuesSchema = z.object({
  ...answerShape,
  dealBreakers: z
    .array(z.enum(values(VALUES_QUESTIONS.map((q) => q.id))))
    .refine(
      (list) => new Set(list).size === DEAL_BREAKER_COUNT,
      `Pick exactly ${DEAL_BREAKER_COUNT} answers that are deal-breakers.`,
    ),
});

// What is stored in profiles.values_answers.
export type StoredValues = Record<
  string,
  { answer: string; dealBreaker: boolean }
>;

export function toStoredValues(parsed: Record<string, unknown>): StoredValues {
  const deal = new Set(parsed.dealBreakers as string[]);
  return Object.fromEntries(
    VALUES_QUESTIONS.map((q) => [
      q.id,
      { answer: parsed[`q_${q.id}`] as string, dealBreaker: deal.has(q.id) },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Step 3: prompts. Fields promptId_0..2 and answer_0..2.
// ---------------------------------------------------------------------------
const promptIdSchema = z.enum(
  values(PROMPTS.map((p) => p.id)),
  "Pick a prompt.",
);
const promptAnswerSchema = z
  .string()
  .trim()
  .min(PROMPT_ANSWER_MIN, `Write at least ${PROMPT_ANSWER_MIN} characters.`)
  .max(PROMPT_ANSWER_MAX, `Keep it under ${PROMPT_ANSWER_MAX} characters.`);

const promptShape: Record<string, z.ZodType> = {};
for (let i = 0; i < PROMPT_COUNT; i++) {
  promptShape[`promptId_${i}`] = promptIdSchema;
  promptShape[`answer_${i}`] = promptAnswerSchema;
}

export const promptsSchema = z.object(promptShape).refine(
  (v) => {
    const ids = Array.from(
      { length: PROMPT_COUNT },
      (_, i) => v[`promptId_${i}`],
    );
    return new Set(ids).size === ids.length;
  },
  { message: "Pick three different prompts.", path: ["promptId_0"] },
);

export type StoredPrompt = { id: string; answer: string };

export function toStoredPrompts(
  parsed: Record<string, unknown>,
): StoredPrompt[] {
  return Array.from({ length: PROMPT_COUNT }, (_, i) => ({
    id: parsed[`promptId_${i}`] as string,
    answer: parsed[`answer_${i}`] as string,
  }));
}

// ---------------------------------------------------------------------------
// Step 4: interests
// ---------------------------------------------------------------------------
export const INTERESTS_ARRAY_FIELDS = ["interests"];

export const interestsSchema = z.object({
  interests: z
    .array(z.enum(values(INTERESTS)))
    .min(MIN_INTERESTS, `Pick at least ${MIN_INTERESTS} interests.`)
    .max(MAX_INTERESTS, `Pick at most ${MAX_INTERESTS} interests.`)
    .refine((l) => new Set(l).size === l.length, "Pick each interest once."),
});

// ---------------------------------------------------------------------------
// Step 5: photos. The browser uploads the files; this checks the list of
// paths it then asks us to save. Every path must be inside the user's own
// folder, so one person cannot save a link to someone else's photo.
// ---------------------------------------------------------------------------
export function makePhotosSchema(userId: string) {
  return z
    .array(z.string())
    .max(MAX_PHOTOS, `You can add up to ${MAX_PHOTOS} photos.`)
    .refine(
      (paths) => paths.every((p) => isOwnPhotoPath(userId, p)),
      "One of the photos is not valid.",
    )
    .refine(
      (paths) => new Set(paths).size === paths.length,
      "Duplicate photo.",
    );
}

// ---------------------------------------------------------------------------
// Pause switch and eLitmus request
// ---------------------------------------------------------------------------
export const pauseSchema = z.object({
  paused: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export const elitmusRequestSchema = z.object({
  phId: phIdSchema,
  consent: z
    .string()
    .optional()
    .refine((v) => v === "on", "Please agree so we can start the check.")
    .transform(() => true as const),
});
