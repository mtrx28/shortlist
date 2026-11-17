"use client";

import { useRef, useState } from "react";
import { savePhotosAction } from "@/app/profile-actions";
import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase/client";
import {
  ALLOWED_PHOTO_TYPES,
  buildPhotoPath,
  checkPhotoFile,
  MAX_PHOTOS,
  PHOTO_BUCKET,
  takeWithinLimit,
} from "@/lib/photos";
import type { SignedPhoto } from "@/lib/profile";

// Add and remove photos. Each picked file is checked, shrunk and re-encoded
// in the browser (which also drops EXIF data such as GPS location), uploaded
// to the private bucket, and then the list is saved by a server action.
export function PhotoManager({
  userId,
  initialPhotos,
}: {
  userId: string;
  initialPhotos: SignedPhoto[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    setError(null);
    const picked = takeWithinLimit(photos.length, Array.from(files ?? []));
    if (picked.length === 0) return;

    const supabase = createBrowserSupabase();
    if (!supabase)
      return setError("Photo upload is not set up on this server.");

    setBusy(true);
    try {
      // Loaded only when someone adds a photo, to keep the first page small.
      const { default: imageCompression } =
        await import("browser-image-compression");
      const newPaths: string[] = [];

      for (const file of picked) {
        const check = checkPhotoFile(file);
        if (!check.ok) {
          setError(check.error);
          continue;
        }
        // Re-drawing the picture onto a canvas is what removes the EXIF data.
        const small = await imageCompression(file, {
          maxSizeMB: 0.8,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
          fileType: "image/webp",
          preserveExif: false,
        });
        const path = buildPhotoPath(userId, crypto.randomUUID());
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, small, { contentType: "image/webp" });
        if (uploadError) {
          setError("We could not upload that photo. Please try again.");
          continue;
        }
        newPaths.push(path);
      }

      if (newPaths.length > 0) {
        const result = await savePhotosAction([
          ...photos.map((p) => p.path),
          ...newPaths,
        ]);
        if (result.error) {
          // Clean up files that were uploaded but not saved.
          await supabase.storage.from(PHOTO_BUCKET).remove(newPaths);
          setError(result.error);
        } else if (result.photos) {
          setPhotos(result.photos);
        }
      }
    } catch {
      setError("Something went wrong with that photo. Try a different one.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(path: string) {
    setError(null);
    setBusy(true);
    const result = await savePhotosAction(
      photos.filter((p) => p.path !== path).map((p) => p.path),
    );
    if (result.error) setError(result.error);
    else if (result.photos) setPhotos(result.photos);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Add 1 to {MAX_PHOTOS} photos (JPEG, PNG or WebP, up to 5 MB each). They
        are shrunk on your phone before uploading and location data is removed.
        Only people you are introduced to can see them.
      </p>

      <ul className="grid grid-cols-2 gap-3">
        {photos.map((p) => (
          <li key={p.path} className="relative">
            {/* Plain img: these are short-lived signed links, not static assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt="Your profile photo"
              className="aspect-[3/4] w-full rounded-md object-cover"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => remove(p.path)}
              className="absolute right-2 bottom-2"
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      {photos.length < MAX_PHOTOS && (
        <div className="space-y-1">
          <label htmlFor="photo-input" className="text-sm font-medium">
            {photos.length === 0 ? "Add photos" : "Add more photos"}
          </label>
          <input
            id="photo-input"
            ref={inputRef}
            type="file"
            accept={ALLOWED_PHOTO_TYPES.join(",")}
            multiple
            disabled={busy}
            onChange={(e) => onPick(e.target.files)}
            className="block w-full text-sm"
          />
        </div>
      )}

      {busy && <p className="text-sm">Working on it...</p>}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
