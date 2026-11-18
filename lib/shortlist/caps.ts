import { SHORTLIST_CONFIG } from "@/config/shortlist";

// The limit on chats open at the same time. Plus members get more. "Plus" is
// active while plus_until is in the future.

export function isPlus(plusUntil: string | Date | null, now: Date): boolean {
  if (!plusUntil) return false;
  return new Date(plusUntil).getTime() > now.getTime();
}

export function chatCap(plusUntil: string | Date | null, now: Date): number {
  return isPlus(plusUntil, now)
    ? SHORTLIST_CONFIG.chatCapPlus
    : SHORTLIST_CONFIG.chatCapFree;
}

export function isAtCap(openChats: number, cap: number): boolean {
  return openChats >= cap;
}

// "2 of 3 chats open"
export function capStatusText(openChats: number, cap: number): string {
  return `${openChats} of ${cap} chats open`;
}
