// lib/imageOrientation.ts
//
// FIX (real bug, found across every photo upload flow in the app):
// camera sensors always capture in a fixed landscape-native orientation
// regardless of how the phone is actually held — a photo taken holding
// the phone upright ("portrait") is really a landscape image with an
// EXIF "Orientation" tag telling viewers to rotate it 90° for display.
// Photo gallery apps read and apply that tag automatically, which is why
// photos always look correct there — but React Native's Image component,
// expo-image, and this app's own upload pipeline all ignore the EXIF
// orientation tag completely and just use the raw, unrotated pixels. The
// practical symptom users see: photos come out sideways, or a photo that
// was clearly taken in landscape displays as portrait (or the reverse),
// inconsistently across iOS/Android.
//
// The fix has to happen once, at the moment a photo is picked/captured,
// by physically baking the correct rotation into the pixel data itself
// (not just reading the tag for later — nothing downstream, including
// Supabase Storage and every screen that displays these photos, respects
// EXIF orientation either). Every screen in the app that picks or
// captures a photo should route it through normalizeImageOrientation()
// before displaying or uploading it.
//
// Requires the `exif: true` option to be passed to whichever picker
// produced the image (ImagePicker.launchImageLibraryAsync/
// launchCameraAsync, or expo-camera's CameraView.takePictureAsync) —
// without it, `asset.exif`/`photo.exif` is always null and this becomes
// a no-op (falls through to returning the original, unrotated uri).

import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Standard EXIF Orientation tag values (1–8) mapped to the clockwise
// rotation needed to correct the image, and whether a horizontal mirror
// is also needed. Values 2/4/5/7 (mirrored) are extremely rare from real
// device cameras — included for completeness, but 1/3/6/8 (plain
// rotation, no mirror) cover essentially every real-world photo.
const ORIENTATION_TO_ROTATION: Record<number, number> = {
  1: 0, 2: 0, 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270,
};
const ORIENTATION_NEEDS_FLIP = new Set([2, 4, 5, 7]);

function readExifOrientation(exif: Record<string, any> | null | undefined): number {
  if (!exif) return 1;
  // Different platforms/SDK versions have been observed reporting this
  // under different casings/paths — check the variants actually seen in
  // the wild rather than trusting a single exact key.
  const raw =
    exif.Orientation ?? exif.orientation ?? exif['{Orientation}'] ?? exif['0th']?.[274];
  const value = typeof raw === 'number' ? raw : parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 && value <= 8 ? value : 1;
}

// Takes a locally picked/captured image (uri + the optional EXIF block
// that comes straight off an expo-image-picker asset or expo-camera
// photo, when that call requested `exif: true`) and returns a new local
// uri with the correct orientation permanently baked into the pixel
// data. Safe to hand straight to prepareUpload() / Image / expo-image
// afterward — no more risk of it rendering sideways regardless of which
// platform or component ends up displaying it.
export async function normalizeImageOrientation(
  uri: string,
  exif?: Record<string, any> | null
): Promise<string> {
  const orientation = readExifOrientation(exif);
  if (orientation === 1) {
    // Already right-side up (or we have no EXIF to go on at all) —
    // skip the re-encode cost entirely.
    return uri;
  }

  try {
    const context = ImageManipulator.manipulate(uri);
    const rotation = ORIENTATION_TO_ROTATION[orientation] ?? 0;
    if (rotation !== 0) context.rotate(rotation);
    if (ORIENTATION_NEEDS_FLIP.has(orientation)) context.flip(FlipType.Horizontal);

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return saved.uri;
  } catch (e) {
    // If normalization fails for any reason, fall back to the original,
    // unrotated uri rather than blocking the upload entirely — a
    // sideways photo is recoverable (retake/reselect); a broken upload
    // flow isn't.
    console.log('normalizeImageOrientation failed, using original uri:', e);
    return uri;
  }
}
