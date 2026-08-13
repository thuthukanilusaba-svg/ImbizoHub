// components/PhotoZoomViewer.native.tsx
//
// Platform-specific wrapper around react-native-image-viewing. This
// file (the .native.tsx variant) is automatically picked by Metro's
// bundler ONLY for iOS/Android builds — never for web — because of the
// .native.tsx naming convention. See PhotoZoomViewer.web.tsx for why
// this split exists: react-native-image-viewing genuinely has no web
// support at all (confirmed directly — its package only ships
// ImageItem.android.js and ImageItem.ios.js, no .web.js and no
// platform-generic fallback), so a plain static import of it in
// listing.tsx broke the web bundle entirely, even though the code path
// that actually uses it never runs on web. Splitting into
// .native.tsx/.web.tsx means Metro resolves the right file per
// platform BEFORE ever trying to statically analyze the import, so web
// never touches this broken dependency at all.

import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import ImageView from 'react-native-image-viewing';

type Props = {
  photos: string[];
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
};

export default function PhotoZoomViewer({ photos, imageIndex, visible, onRequestClose }: Props) {
  // NEW: rotating the phone while looking at a photo full-screen should
  // actually rotate the photo with it — like Photos/Instagram — rather
  // than staying locked portrait the way the rest of the app
  // deliberately does (see _layout.tsx, which establishes that portrait
  // lock as the app-wide default). This is the one screen that opts out
  // of it, only while it's actually open, restoring the normal lock the
  // moment it closes so nothing else in the app is affected.
  useEffect(() => {
    if (visible) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL).catch(() => {});
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    // Belt-and-braces: restore the portrait lock if this component ever
    // unmounts while still visible (e.g. the listing screen itself gets
    // popped off the stack mid-view), not just on the normal close path.
    return () => {
      if (visible) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    };
  }, [visible]);

  return (
    <ImageView
      images={photos.map((uri) => ({ uri }))}
      imageIndex={imageIndex}
      visible={visible}
      onRequestClose={onRequestClose}
    />
  );
}
