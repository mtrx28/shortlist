import type { DecideInput, Gender } from "@/lib/shortlist/decide";

// Builds a DecideInput for tests, with every field given a sensible default
// (a man answering an intro from a woman, nothing special going on).

export type Overrides = {
  decision?: DecideInput["decision"];
  viewerGender?: Gender | null;
  otherGender?: Gender | null;
  status?: "new" | "passed" | "interested" | "expired";
  expired?: boolean;
  owner?: string;
  noIntro?: boolean;
  otherIntro?: "new" | "passed" | "interested" | "expired" | null;
  viewerChats?: number;
  otherChats?: number;
  viewerCap?: number;
  otherCap?: number;
  viewerAvailable?: boolean;
  otherAvailable?: boolean;
  blocked?: boolean;
  liveChat?: boolean;
  viewerDecidedAt?: number;
  otherDecidedAt?: number;
};

export function input(o: Overrides = {}): DecideInput {
  return {
    decision: o.decision ?? "interested",
    viewer: {
      id: "viewer",
      gender: o.viewerGender === undefined ? "man" : o.viewerGender,
      openChats: o.viewerChats ?? 0,
      cap: o.viewerCap ?? 3,
      available: o.viewerAvailable ?? true,
    },
    intro: o.noIntro
      ? null
      : {
          ownerId: o.owner ?? "viewer",
          status: o.status ?? "new",
          expired: o.expired ?? false,
          decidedAtMs: o.viewerDecidedAt ?? 2000,
        },
    other: {
      id: "other",
      gender: o.otherGender === undefined ? "woman" : o.otherGender,
      openChats: o.otherChats ?? 0,
      cap: o.otherCap ?? 3,
      available: o.otherAvailable ?? true,
      blocked: o.blocked ?? false,
      introStatus: o.otherIntro === undefined ? "new" : o.otherIntro,
      introDecidedAtMs: o.otherDecidedAt ?? 1000,
    },
    hasLiveChat: o.liveChat ?? false,
  };
}
