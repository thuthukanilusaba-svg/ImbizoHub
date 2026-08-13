// components/PhotoZoomViewer.native.tsx
//
// Platform-specific wrapper for the full-screen photo viewer. This file
// (the .native.tsx variant) is automatically picked by Metro's bundler
// ONLY for iOS/Android builds — never for web — because of the
// .native.tsx naming convention. See PhotoZoomViewer.web.tsx for the
// web version.
//
// FIX: this used to wrap react-native-image-viewing, a third-party
// pinch-zoom library. Users reported photos opening full-screen
// "oversize" — zoomed in and cropped, unable to see the whole photo.
// Diagnosed as a known compatibility issue between that (unmaintained)
// library and React Native's New Architecture. Rather than patch
// around a dead dependency, this is now a hand-built viewer using only
// native modules already installed in this app (gesture-handler,
// reanimated, worklets, expo-image) — see PinchZoomImage.tsx for the
// actual pinch/pan/double-tap/swipe gesture logic. Because nothing new
// was added to package.json, this ships as a normal JS/OTA update, not
// a new native build.

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import PinchZoomImage from './PinchZoomImage';

type Props = {
  photos: string[];
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
};

export default function PhotoZoomViewer({ photos, imageIndex, visible, onRequestClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(imageIndex);

  // Whenever the viewer is (re)opened, start at whichever photo the
  // caller asked for (e.g. the carousel's currently-active photo) —
  // not wherever a previous open of the viewer happened to leave off.
  useEffect(() => {
    if (visible) {
      setCurrentIndex(imageIndex);
    }
  }, [visible, imageIndex]);

  // NOTE: this used to also rotate the photo along with the phone
  // (via expo-screen-orientation) when turned to landscape. That's been
  // pulled back out for now — see _layout.tsx for why — and will come
  // back in its own dedicated app-store build. The viewer itself still
  // works normally in portrait.

  if (!visible || photos.length === 0) return null;

  const safeIndex = Math.min(currentIndex, photos.length - 1);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      {/* react-native-gesture-handler needs its own root inside a Modal
          — Modals render in a separate native window, so a
          GestureHandlerRootView at the app's top level alone isn't
          enough for gestures here to work reliably (especially on
          Android). */}
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.container}>
          <PinchZoomImage
            key={photos[safeIndex]}
            uri={photos[safeIndex]}
            hasNext={safeIndex < photos.length - 1}
            hasPrev={safeIndex > 0}
            onNext={() => setCurrentIndex((i) => Math.min(i + 1, photos.length - 1))}
            onPrev={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
            onDismiss={onRequestClose}
          />

          <View style={styles.header} pointerEvents="box-none">
            <Pressable onPress={onRequestClose} hitSlop={16} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
            {photos.length > 1 && (
              <View style={styles.counter}>
                <Text style={styles.counterText}>{safeIndex + 1}/{photos.length}</Text>
              </View>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  counter: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
