// components/PhotoZoomViewer.web.tsx
//
// Web-only fallback — see PhotoZoomViewer.native.tsx for the full
// explanation of why this split exists (react-native-image-viewing has
// no web support whatsoever, confirmed directly). Rather than a silent
// no-op on web (tapping a photo would do nothing, which is worse than
// just not having the feature — confusing, looks broken), this is a
// genuinely functional lightbox built from only built-in React Native
// Web-safe components: a full-screen Modal showing the photo larger,
// with prev/next arrows if there's more than one, and a close button.
// No pinch-to-zoom gesture (that needs a real gesture library, out of
// scope for a same-day fix) — but a real, working "see it bigger" view
// either way, not nothing.

import { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';

type Props = {
  photos: string[];
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
};

export default function PhotoZoomViewer({ photos, imageIndex, visible, onRequestClose }: Props) {
  const [index, setIndex] = useState(imageIndex);

  // Keep in sync with whichever photo was tapped in the carousel each
  // time the viewer opens — same behavior the native version gets for
  // free from its own imageIndex prop.
  useEffect(() => { if (visible) setIndex(imageIndex); }, [visible, imageIndex]);

  if (!photos.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.closeBtn} onPress={onRequestClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>

        <Image source={{ uri: photos[index] }} style={styles.image} resizeMode="contain" />

        {photos.length > 1 && (
          <>
            <TouchableOpacity
              style={[styles.navBtn, styles.navBtnLeft]}
              onPress={() => setIndex((i) => (i === 0 ? photos.length - 1 : i - 1))}
            >
              <Text style={styles.navBtnText}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navBtn, styles.navBtnRight]}
              onPress={() => setIndex((i) => (i === photos.length - 1 ? 0 : i + 1))}
            >
              <Text style={styles.navBtnText}>›</Text>
            </TouchableOpacity>
            <View style={styles.counter}>
              <Text style={styles.counterText}>{index + 1} / {photos.length}</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '90%', height: '80%' },
  closeBtn: {
    position: 'absolute', top: 24, right: 24, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  closeBtnText: { color: '#fff', fontSize: 20 },
  navBtn: {
    position: 'absolute', top: '50%', marginTop: -24, width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  navBtnLeft: { left: 16 },
  navBtnRight: { right: 16 },
  navBtnText: { color: '#fff', fontSize: 28, lineHeight: 30 },
  counter: {
    position: 'absolute', bottom: 32, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5,
  },
  counterText: { color: GOLD, fontSize: 12, fontWeight: '700' },
});
