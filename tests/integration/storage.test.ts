import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_BUCKET } from "@/lib/photos";
import {
  TINY_JPEG,
  createMember,
  finishProfile,
  introduce,
  removeMembers,
  service,
  signedInClient,
  uniq,
  type Member,
} from "../support/stack";

// The private photo bucket on the real Storage service: upload rules, size and
// type limits, signed links, and who may see whose photos.

describe("profile photo storage (real Storage + policies)", () => {
  let owner: Member;
  let viewer: Member; // was introduced to the owner
  let stranger: Member;
  const city = uniq("City");

  beforeAll(async () => {
    owner = await createMember("Owner");
    viewer = await createMember("Viewer");
    stranger = await createMember("Stranger");
    await finishProfile(owner, {
      gender: "woman",
      interestedIn: ["man"],
      city,
    });
    await finishProfile(viewer, {
      gender: "man",
      interestedIn: ["woman"],
      city,
    });
    await finishProfile(stranger, {
      gender: "man",
      interestedIn: ["woman"],
      city,
    });
    await introduce(viewer, owner, "2026-11-09");
  });
  afterAll(async () => {
    for (const m of [owner, viewer, stranger]) {
      const { data } = await service.storage.from(PHOTO_BUCKET).list(m.id);
      if (data?.length) {
        await service.storage
          .from(PHOTO_BUCKET)
          .remove(data.map((f) => `${m.id}/${f.name}`));
      }
    }
    await removeMembers([owner, viewer, stranger]);
  });

  const jpeg = (
    client: Awaited<ReturnType<typeof signedInClient>>,
    path: string,
    body: Buffer = TINY_JPEG,
    type = "image/jpeg",
  ) =>
    client.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: type });

  it("lets a person upload into their own folder", async () => {
    const c = await signedInClient(owner);
    const { error } = await jpeg(c, `${owner.id}/one.jpg`);
    expect(error).toBeNull();
  });

  it("refuses an upload into somebody else's folder", async () => {
    const c = await signedInClient(stranger);
    const { error } = await jpeg(c, `${owner.id}/evil.jpg`);
    expect(error).toBeTruthy();
    const { data } = await service.storage.from(PHOTO_BUCKET).list(owner.id);
    expect(data?.map((f) => f.name)).not.toContain("evil.jpg");
  });

  it("refuses files that are not images", async () => {
    const c = await signedInClient(owner);
    const { error } = await jpeg(
      c,
      `${owner.id}/doc.pdf`,
      Buffer.from("%PDF-1.4 test"),
      "application/pdf",
    );
    expect(error).toBeTruthy();
  });

  it("refuses a file over 5 MB", async () => {
    const c = await signedInClient(owner);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1);
    const { error } = await jpeg(c, `${owner.id}/big.jpg`, big);
    expect(error).toBeTruthy();
  });

  it("stops at 8 files in one folder", async () => {
    const c = await signedInClient(owner);
    let refused = 0;
    for (let i = 0; i < 10; i++) {
      const { error } = await jpeg(c, `${owner.id}/many-${i}.jpg`);
      if (error) refused++;
    }
    expect(refused).toBeGreaterThanOrEqual(2);
    const { data } = await service.storage.from(PHOTO_BUCKET).list(owner.id);
    expect(data!.length).toBeLessThanOrEqual(8);
  });

  it("makes signed links only for photos you may see", async () => {
    const o = await signedInClient(owner);
    const own = await o.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(`${owner.id}/one.jpg`, 60);
    expect(own.data?.signedUrl).toBeTruthy();
    // The link really serves the image bytes.
    const res = await fetch(own.data!.signedUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");

    // Introduced: allowed.
    const v = await signedInClient(viewer);
    const intro = await v.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(`${owner.id}/one.jpg`, 60);
    expect(intro.data?.signedUrl).toBeTruthy();

    // A stranger: refused, and the plain public address does not work either.
    const s = await signedInClient(stranger);
    const denied = await s.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(`${owner.id}/one.jpg`, 60);
    expect(denied.data?.signedUrl).toBeFalsy();
    const publicUrl = s.storage
      .from(PHOTO_BUCKET)
      .getPublicUrl(`${owner.id}/one.jpg`).data.publicUrl;
    const open = await fetch(publicUrl);
    expect(open.status).not.toBe(200);
  });

  it("hides photos again once the viewer is blocked", async () => {
    const blockRes = await service.rpc("block_user", {
      p_blocker: owner.id,
      p_target: viewer.id,
    });
    expect(blockRes.error).toBeNull();
    const v = await signedInClient(viewer);
    const { data } = await v.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(`${owner.id}/one.jpg`, 60);
    expect(data?.signedUrl).toBeFalsy();
  });

  it("does not let one person delete another person's photo", async () => {
    const s = await signedInClient(stranger);
    await s.storage.from(PHOTO_BUCKET).remove([`${owner.id}/one.jpg`]);
    const { data } = await service.storage.from(PHOTO_BUCKET).list(owner.id);
    expect(data?.map((f) => f.name)).toContain("one.jpg");
  });
});
