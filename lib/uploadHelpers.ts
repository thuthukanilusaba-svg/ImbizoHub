// lib/uploadHelpers.ts
//
// FIX (real, functional bug — not just the earlier deprecation warning):
// every image upload in this app used fetch(uri).then(r => r.blob())
// before handing the result to supabase.storage.upload(). This is a
// well-known, Supabase-documented failure mode on React Native/Expo:
// the underlying Blob polyfill can throw "Creating blobs from
// 'ArrayBuffer' and 'ArrayBufferView' are not supported" — this is not
// specific to any one screen, it's the exact same bug wherever this
// pattern is used, which is why it showed up on both the listing-post
// flow and ID verification (and would show up identically on every
// other upload screen using the same pattern, since all five use it).
//
// Supabase's own official guidance (supabase.com/blog/react-native-storage)
// is to skip Blob entirely on native: read the file as a base64
// string, decode that to raw bytes, and upload the bytes directly —
// supabase-js's upload() accepts an ArrayBuffer/Uint8Array natively,
// no Blob needed anywhere in that path.
//
// IMPORTANT — platform-aware: the Blob bug above is specific to React
// Native's polyfill on iOS/Android. Real web browsers have a proper
// native Blob implementation with no such bug, and on web,
// expo-image-picker's uri is a blob: URL rather than a file:// URI,
// which expo-file-system's readAsStringAsync can't read at all. So web
// keeps the original fetch().blob() approach (which genuinely works
// fine there), and only native switches to the ArrayBuffer approach.
//
// Uses the EXPLICIT expo-file-system/legacy import rather than the
// default 'expo-file-system' path — per the deprecation warning's own
// wording ("import the legacy API from 'expo-file-system/legacy'"),
// this avoids the deprecation entirely (and, per current SDK 54 stable
// behavior, avoids it actually throwing) while still using the exact
// same, long-proven readAsStringAsync implementation.

import { decode } from 'base64-arraybuffer';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export type PreparedUpload = {
  data: ArrayBuffer | Blob;
  contentType: string;
  extension: string;
};

// Converts a local image URI (from expo-image-picker, gallery or
// camera, on any platform) into everything needed to call
// supabase.storage.from(...).upload(path, data, { contentType })
// directly — no Blob-construction bug on native, and correct content-
// type detection on both native (from the file extension) and web
// (from the browser's own reported Blob.type, since a blob: URL has no
// real file extension to read).
export async function prepareUpload(uri: string): Promise<PreparedUpload> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
      'image/webp': 'webp', 'image/heic': 'heic',
    };
    const contentType = blob.type || 'image/jpeg';
    return { data: blob, contentType, extension: mimeToExt[contentType] || 'jpg' };
  }

  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const arrayBuffer = decode(base64);

  const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase();
  const extToMime: Record<string, string> = {
    png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic',
  };
  // jpg/jpeg and anything unrecognized fall back to jpeg — that's what
  // expo-image-picker outputs by default on both native platforms.
  const contentType = (ext && extToMime[ext]) || 'image/jpeg';
  const extension = contentType.split('/')[1];

  return { data: arrayBuffer, contentType, extension };
}