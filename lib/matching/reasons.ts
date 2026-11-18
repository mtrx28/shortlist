// "Why we matched": two plain sentences per intro, taken from the signals that
// added the most to the score.
//
// Privacy rules for these sentences:
//   * they are built only from things the viewer can already see on the
//     candidate's profile (city, interests, batch, intent, a reply-rate band);
//   * they never use the date of birth, an exact age, the pH ID, or the
//     deal-breaker flags. The order of topics follows the VIEWER's own
//     deal-breakers only, so the other person's choices do not leak.
//   * the values sentence names the topic ("how close you stay to family"),
//     not the answer.

import { VALUE_TOPICS, type MatchingConfig } from "@/config/matching";
import { sharedInterests } from "./score";
import type { Intent, Member, ScoreBreakdown } from "./types";

const INTENT_PHRASE: Record<Intent, string> = {
  serious: "a serious relationship",
  open_to_see: "seeing where things go",
  friendships_first: "friendship first",
};

type Candidate = { contribution: number; text: string | null };

// "a", "a and b", "a, b and c"
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function buildReasons(
  viewer: Member,
  candidate: Member,
  breakdown: ScoreBreakdown & { matchedQuestions: string[] },
  config: MatchingConfig,
): string[] {
  const w = config.weights;

  // Topics both answered the same way. The viewer's own deal-breakers come
  // first, then the questions in their usual order.
  const topics = breakdown.matchedQuestions
    .filter((id) => VALUE_TOPICS[id])
    .sort(
      (a, b) =>
        Number(viewer.values[b].dealBreaker) -
        Number(viewer.values[a].dealBreaker),
    )
    .slice(0, 2)
    .map((id) => VALUE_TOPICS[id]);

  const interests = sharedInterests(viewer, candidate).slice(0, 2);

  const sameBatch = viewer.batchYear === candidate.batchYear;

  // The order here is the tie-break when two signals contribute the same.
  const options: Candidate[] = [
    {
      contribution: w.values * breakdown.values,
      text: topics.length ? `You answered alike on ${joinWords(topics)}` : null,
    },
    {
      contribution: w.interests * breakdown.interests,
      text: interests.length ? `You both enjoy ${joinWords(interests)}` : null,
    },
    {
      contribution: w.lifeStage * breakdown.lifeStage,
      text:
        breakdown.lifeStage > 0
          ? sameBatch
            ? "You are from the same pH batch"
            : "You are from nearby pH batches"
          : null,
    },
    {
      contribution: w.intent * breakdown.intent,
      text:
        viewer.intent === candidate.intent
          ? `You are both looking for ${INTENT_PHRASE[viewer.intent]}`
          : null,
    },
    {
      contribution: w.responsiveness * breakdown.responsiveness,
      // Only the top reply band gets a sentence; the neutral "not enough
      // chats yet" value must not read as praise.
      text:
        candidate.repliesDen >= config.minChatsForReplyRate &&
        breakdown.responsiveness >= (config.replyBands[0]?.value ?? 1)
          ? "They usually reply to messages"
          : null,
    },
  ];

  const reasons = options
    .map((o, order) => ({ ...o, order }))
    .filter((o) => o.text && o.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution || a.order - b.order)
    .map((o) => o.text as string)
    .slice(0, config.reasonsPerIntro);

  // Always say something true: the city is the fallback.
  if (reasons.length < config.reasonsPerIntro) {
    reasons.push(`You are both in ${candidate.city}`);
  }
  return reasons.slice(0, config.reasonsPerIntro);
}
