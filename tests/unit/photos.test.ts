import { describe, expect, it } from "vitest";
import {
  buildPhotoPath,
  checkPhotoFile,
  isOwnPhotoPath,
  MAX_PHOTOS,
  MAX_UPLOAD_BYTES,
  slotsLeft,
  takeWithinLimit,
} from "@/lib/photos";

describe("checkPhotoFile", () => {
  it("accepts jpeg, png and webp under 5 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(checkPhotoFile({ type, size: 1000 }).ok).toBe(true);
    }
    expect(
      checkPhotoFile({ type: "image/png", size: MAX_UPLOAD_BYTES }).ok,
    ).toBe(true);
  });

  it("rejects other types, big files and empty files", () => {
    expect(checkPhotoFile({ type: "image/gif", size: 1000 }).ok).toBe(false);
    expect(checkPhotoFile({ type: "application/pdf", size: 1000 }).ok).toBe(
      false,
    );
    expect(checkPhotoFile({ type: "image/heic", size: 1000 }).ok).toBe(false);
    const big = checkPhotoFile({
      type: "image/jpeg",
      size: MAX_UPLOAD_BYTES + 1,
    });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/5 MB/);
    expect(checkPhotoFile({ type: "image/jpeg", size: 0 }).ok).toBe(false);
  });
});

describe("photo limit", () => {
  it("allows at most 4 photos", () => {
    expect(MAX_PHOTOS).toBe(4);
    expect(slotsLeft(0)).toBe(4);
    expect(slotsLeft(3)).toBe(1);
    expect(slotsLeft(4)).toBe(0);
    expect(slotsLeft(9)).toBe(0);
  });

  it("keeps only as many picked files as there is room for", () => {
    expect(takeWithinLimit(0, [1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4]);
    expect(takeWithinLimit(3, [1, 2, 3])).toEqual([1]);
    expect(takeWithinLimit(4, [1])).toEqual([]);
  });
});

describe("photo paths", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const file = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("puts every file in the owner's folder", () => {
    const path = buildPhotoPath(user, file);
    expect(path).toBe(`${user}/${file}.webp`);
    expect(isOwnPhotoPath(user, path)).toBe(true);
  });

  it("refuses paths outside your folder or with tricks", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    expect(isOwnPhotoPath(user, `${other}/${file}.webp`)).toBe(false);
    expect(isOwnPhotoPath(user, `${user}/../${other}/${file}.webp`)).toBe(
      false,
    );
    expect(isOwnPhotoPath(user, `${user}/${file}.exe`)).toBe(false);
    expect(isOwnPhotoPath(user, `${user}/sub/${file}.webp`)).toBe(false);
    expect(isOwnPhotoPath(user, "")).toBe(false);
  });
});
