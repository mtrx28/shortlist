import { z } from "zod";
import { REPORT_REASONS } from "@/config/safety";

// Inputs of the safety server actions. Every action is a public endpoint, so
// the shape is checked here whatever the browser did.

const reasonIds = REPORT_REASONS.map((r) => r.id) as [string, ...string[]];

export const blockSchema = z.object({
  targetId: z.uuid(),
});

export const reportSchema = z.object({
  targetId: z.uuid(),
  conversationId: z.uuid().nullable().optional(),
  reason: z.enum(reasonIds),
  details: z.string().max(1000).optional(),
  attach: z.boolean().optional(),
  alsoBlock: z.boolean().optional(),
});

export const endChatSchema = z.object({
  conversationId: z.uuid(),
  templateId: z.string().max(40),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(100),
  email: z.email("Please enter a valid email address.").max(200),
  message: z
    .string()
    .trim()
    .min(10, "Please write at least a sentence (10 characters).")
    .max(2000, "Please keep it under 2000 characters."),
});
