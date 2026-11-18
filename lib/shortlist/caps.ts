import { entitlements, isPlus } from "@/lib/plus";

// The limit on chats open at the same time. Plus members get more. What Plus
// means is decided in lib/plus.ts; this file only keeps the names the
// shortlist code already uses.

export { isPlus };

export function chatCap(plusUntil: string | Date | null, now: Date): number {
  return entitlements(plusUntil, now).chatCap;
}

export function isAtCap(openChats: number, cap: number): boolean {
  return openChats >= cap;
}

// "2 of 3 chats open"
export function capStatusText(openChats: number, cap: number): string {
  return `${openChats} of ${cap} chats open`;
}
