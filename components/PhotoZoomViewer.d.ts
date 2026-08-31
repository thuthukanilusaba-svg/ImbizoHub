// components/PhotoZoomViewer.d.ts
//
// WHY THIS FILE EXISTS.
// PhotoZoomViewer ships as two platform builds — PhotoZoomViewer.native.tsx
// and PhotoZoomViewer.web.tsx — and callers import it without an extension:
//
//   import PhotoZoomViewer from '../../components/PhotoZoomViewer';
//
// Metro resolves that correctly, picking .native.tsx on iOS/Android and
// .web.tsx in the browser. TypeScript does not: it has no concept of
// Metro's platform extensions, so it looked for a plain PhotoZoomViewer
// module, found none, and reported "Cannot find module" on every import —
// a permanent error for code that has always worked.
//
// A declaration file is the right fix rather than a stub .tsx. Metro
// ignores .d.ts entirely, so nothing about the runtime changes; TypeScript
// gets the contract it was missing. A stub .tsx would sit in the
// resolution order as a real module and could quietly be bundled the day
// someone adds a platform Metro has no specific build for.
//
// Keep the props here in step with the two implementations — they are
// identical in both today.

import type { ComponentType } from 'react';

export type PhotoZoomViewerProps = {
  /** Image URLs, in the order they should be swiped through. */
  photos: string[];
  /** Which of `photos` to open on. */
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
};

declare const PhotoZoomViewer: ComponentType<PhotoZoomViewerProps>;
export default PhotoZoomViewer;
