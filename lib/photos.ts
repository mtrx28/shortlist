// Rules for profile photos. Pure functions so they are easy to test; the
// upload component, the server action and the tests all use them.

export const PHOTO_BUCKET = "profile-photos";
export const MAX_PHOTOS = 4;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB before compression
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Compressed photos are saved as WebP.
export const SAVED_PHOTO_EXTENSION = "webp";

export type PhotoCheck = { ok: true } | { ok: false; error: string };

export function checkPhotoFile(file: {
  type: string;
  size: number;
}): PhotoCheck {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That photo is over 5 MB. Pick a smaller one." };
  }
  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }
  return { ok: true };
}

// How many more photos can be added.
export function slotsLeft(currentCount: number): number {
  return Math.max(0, MAX_PHOTOS - currentCount);
}

// Which of the picked files to take when the person picks more than fit.
export function takeWithinLimit<T>(currentCount: number, picked: T[]): T[] {
  return picked.slice(0, slotsLeft(currentCount));
}

// Every file lives in a folder named after its owner. The storage policy
// relies on this, so the path is built in one place.
export function buildPhotoPath(userId: string, fileId: string): string {
  return `${userId}/${fileId}.${SAVED_PHOTO_EXTENSION}`;
}

const FILE_PART =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function isOwnPhotoPath(userId: string, path: string): boolean {
  const re = new RegExp(`^${userId}/${FILE_PART}\.(webp|jpg|png)$`, "i");
  return re.test(path);
}
