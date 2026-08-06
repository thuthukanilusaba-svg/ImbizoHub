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

import ImageView from 'react-native-image-viewing';

type Props = {
  photos: string[];
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
};

export default function PhotoZoomViewer({ photos, imageIndex, visible, onRequestClose }: Props) {
  return (
    <ImageView
      images={photos.map((uri) => ({ uri }))}
      imageIndex={imageIndex}
      visible={visible}
      onRequestClose={onRequestClose}
    />
  );
}
