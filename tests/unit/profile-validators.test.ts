import { describe, expect, it } from "vitest";
import { VALUES_QUESTIONS } from "@/config/values-questions";
import {
  basicsSchema,
  elitmusRequestSchema,
  formToObject,
  interestsSchema,
  makePhotosSchema,
  pauseSchema,
  promptsSchema,
  toStoredPrompts,
  toStoredValues,
  valuesSchema,
} from "@/lib/validators/profile";
import { toFormState } from "@/lib/validators/auth";

const validBasics = {
  displayName: "Asha",
  gender: "woman",
  interestedIn: ["man"],
  city: "Pune",
  intent: "serious",
  batchYear: "2022",
  occupation: "Analyst",
  collegeTier: "tier2",
};

describe("formToObject", () => {
  it("turns repeated fields into arrays and keeps single ones as strings", () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("tags", "x");
    const obj = formToObject(fd, ["tags", "missing"]);
    expect(obj).toEqual({ a: "1", tags: ["x"], missing: [] });
  });
});

describe("basicsSchema", () => {
  it("accepts a valid form", () => {
    const r = basicsSchema.safeParse(validBasics);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.batchYear).toBe(2022);
  });

  it("treats the college tier as optional", () => {
    const r = basicsSchema.safeParse({ ...validBasics, collegeTier: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.collegeTier).toBeUndefined();
    const without: Record<string, unknown> = { ...validBasics };
    delete without.collegeTier;
    expect(basicsSchema.safeParse(without).success).toBe(true);
  });

  it.each([
    ["empty name", { displayName: "   " }, "displayName"],
    ["long name", { displayName: "a".repeat(51) }, "displayName"],
    ["unknown gender", { gender: "robot" }, "gender"],
    ["nobody to meet", { interestedIn: [] }, "interestedIn"],
    ["city not in list", { city: "Mumbai" }, "city"],
    ["unknown intent", { intent: "fun" }, "intent"],
    ["batch too early", { batchYear: "2019" }, "batchYear"],
    ["batch too late", { batchYear: "2024" }, "batchYear"],
    ["batch not a number", { batchYear: "abc" }, "batchYear"],
    ["one letter job", { occupation: "a" }, "occupation"],
    ["bad tier", { collegeTier: "tier9" }, "collegeTier"],
  ])("rejects %s", (_name, change, field) => {
    const r = basicsSchema.safeParse({ ...validBasics, ...change });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(toFormState(r.error).fieldErrors?.[field]).toBeDefined();
    }
  });
});

function validValuesForm() {
  const form: Record<string, unknown> = { dealBreakers: ["kids", "family"] };
  for (const q of VALUES_QUESTIONS) form[`q_${q.id}`] = q.options[0].id;
  return form;
}

describe("valuesSchema", () => {
  it("accepts 8 answers and exactly 2 deal-breakers", () => {
    expect(valuesSchema.safeParse(validValuesForm()).success).toBe(true);
  });

  it("rejects a missing answer and names the question", () => {
    const form = validValuesForm();
    delete form.q_money;
    const r = valuesSchema.safeParse(form);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(toFormState(r.error).fieldErrors?.q_money).toBeDefined();
    }
  });

  it("rejects an answer that is not an option of that question", () => {
    const r = valuesSchema.safeParse({ ...validValuesForm(), q_kids: "nope" });
    expect(r.success).toBe(false);
  });

  it.each([
    ["none", []],
    ["one", ["kids"]],
    ["three", ["kids", "family", "money"]],
    ["the same one twice", ["kids", "kids"]],
    ["an unknown question", ["kids", "nope"]],
  ])("rejects %s deal-breakers", (_name, dealBreakers) => {
    const r = valuesSchema.safeParse({ ...validValuesForm(), dealBreakers });
    expect(r.success).toBe(false);
  });

  it("stores answers with the deal-breaker flags", () => {
    const parsed = valuesSchema.parse(validValuesForm());
    const stored = toStoredValues(parsed);
    expect(Object.keys(stored)).toHaveLength(VALUES_QUESTIONS.length);
    expect(stored.kids).toEqual({ answer: "yes", dealBreaker: true });
    expect(stored.family.dealBreaker).toBe(true);
    expect(stored.money.dealBreaker).toBe(false);
    expect(Object.values(stored).filter((v) => v.dealBreaker)).toHaveLength(2);
  });
});

const validPrompts = {
  promptId_0: "weekend_plan",
  answer_0: "Slow coffee and a long walk.",
  promptId_1: "geek_out",
  answer_1: "Old Hindi film music, honestly.",
  promptId_2: "comfort",
  answer_2: "Rajma chawal with pickle.",
};

describe("promptsSchema", () => {
  it("accepts three different prompts with answers", () => {
    const r = promptsSchema.safeParse(validPrompts);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(toStoredPrompts(r.data)).toEqual([
        { id: "weekend_plan", answer: "Slow coffee and a long walk." },
        { id: "geek_out", answer: "Old Hindi film music, honestly." },
        { id: "comfort", answer: "Rajma chawal with pickle." },
      ]);
    }
  });

  it("rejects a repeated prompt", () => {
    expect(
      promptsSchema.safeParse({ ...validPrompts, promptId_1: "weekend_plan" })
        .success,
    ).toBe(false);
  });

  it("rejects too short and too long answers", () => {
    expect(
      promptsSchema.safeParse({ ...validPrompts, answer_0: "short" }).success,
    ).toBe(false);
    expect(
      promptsSchema.safeParse({ ...validPrompts, answer_0: "a".repeat(201) })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown prompt id", () => {
    expect(
      promptsSchema.safeParse({ ...validPrompts, promptId_2: "made_up" })
        .success,
    ).toBe(false);
  });
});

describe("interestsSchema", () => {
  it("accepts 3 to 8 known interests", () => {
    expect(
      interestsSchema.safeParse({ interests: ["Cricket", "Coffee", "Travel"] })
        .success,
    ).toBe(true);
  });

  it("rejects too few, too many, unknown and duplicates", () => {
    expect(interestsSchema.safeParse({ interests: ["Cricket"] }).success).toBe(
      false,
    );
    expect(
      interestsSchema.safeParse({
        interests: [
          "Cricket",
          "Football",
          "Running",
          "Gym",
          "Trekking",
          "Cycling",
          "Yoga",
          "Badminton",
          "Cooking",
        ],
      }).success,
    ).toBe(false);
    expect(
      interestsSchema.safeParse({ interests: ["Cricket", "Coffee", "Nope"] })
        .success,
    ).toBe(false);
    expect(
      interestsSchema.safeParse({ interests: ["Cricket", "Cricket", "Coffee"] })
        .success,
    ).toBe(false);
  });
});

describe("makePhotosSchema", () => {
  const me = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const file = (owner: string, n: number) =>
    `${owner}/0000000${n}-0000-4000-8000-000000000000.webp`;

  it("accepts up to 4 photos in your own folder", () => {
    const schema = makePhotosSchema(me);
    expect(schema.safeParse([]).success).toBe(true);
    expect(schema.safeParse([file(me, 1), file(me, 2)]).success).toBe(true);
  });

  it("rejects more than 4, someone else's folder, and duplicates", () => {
    const schema = makePhotosSchema(me);
    expect(
      schema.safeParse([1, 2, 3, 4, 5].map((n) => file(me, n))).success,
    ).toBe(false);
    expect(schema.safeParse([file(other, 1)]).success).toBe(false);
    expect(schema.safeParse([file(me, 1), file(me, 1)]).success).toBe(false);
    expect(schema.safeParse([`${me}/../${other}/x.webp`]).success).toBe(false);
  });
});

describe("pauseSchema and elitmusRequestSchema", () => {
  it("parses the pause flag", () => {
    expect(pauseSchema.parse({ paused: "true" }).paused).toBe(true);
    expect(pauseSchema.parse({ paused: "false" }).paused).toBe(false);
    expect(pauseSchema.safeParse({ paused: "yes" }).success).toBe(false);
  });

  it("needs a valid pH ID and the consent tick", () => {
    expect(
      elitmusRequestSchema.safeParse({ phId: "ph-123456", consent: "on" })
        .success,
    ).toBe(true);
    expect(elitmusRequestSchema.safeParse({ phId: "ph-123456" }).success).toBe(
      false,
    );
    expect(
      elitmusRequestSchema.safeParse({ phId: "12", consent: "on" }).success,
    ).toBe(false);
  });
});
