// components/IdCameraCapture.tsx
//
// Custom camera capture screen with a visible ID-boundary guide
// overlay, replacing the plain OS camera picker (ImagePicker.
// launchCameraAsync) for ID-photo capture specifically.
//
// WHY THIS NEEDED A DIFFERENT LIBRARY: expo-image-picker's
// launchCameraAsync opens the device's own native camera app/picker
// screen — a full OS-level UI with zero ability to layer custom
// content (like an alignment guide) on top of the live preview. To
// actually show a boundary overlay while the camera is active, the
// live preview has to render INSIDE this app's own view tree instead,
// which is what expo-camera's <CameraView> provides — a real-time
// camera feed as a regular React Native component, letting ordinary
// Views (like the dimmed mask + cutout frame below) sit on top of it.
//
// Reusable across both ID-verification screens that need this
// (operator-id-verify.tsx and verified-seller-pay.tsx) — same guided-
// capture UI, not duplicated per screen.
//
// Usage:
//   <IdCameraCapture
//     visible={showCamera}
//     onCapture={(uri) => { setPickedImageUri(uri); setShowCamera(false); }}
//     onClose={() => setShowCamera(false)}
//   />

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
    ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { normalizeImageOrientation } from '../lib/imageOrientation';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';

// Standard ID/credit-card aspect ratio (width:height), used to shape
// the cutout guide so it actually matches the proportions of a real ID
// card rather than an arbitrary rectangle.
const ID_ASPECT_RATIO = 1.586;

type Props = {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
};

export default function IdCameraCapture({ visible, onCapture, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      // FIX: same EXIF-orientation issue as every other photo upload
      // flow in the app (see lib/imageOrientation.ts) — an ID photo
      // captured while holding the phone in portrait, the normal way
      // anyone would photograph an ID card, can otherwise come out
      // sideways once uploaded. Normalized once, here, so both callers
      // of this shared component (operator-id-verify.tsx and
      // verified-seller-pay.tsx) get a correctly-oriented uri without
      // needing to handle it themselves.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, exif: true });
      if (photo?.uri) {
        const normalizedUri = await normalizeImageOrientation(photo.uri, photo.exif);
        onCapture(normalizedUri);
      }
    } catch (err) {
      // Silently fall through — the person can just try the shutter
      // button again. A one-off camera hiccup here isn't worth a full
      // error banner over, on a screen whose only purpose is retrying
      // this exact action.
      console.log('ID photo capture failed:', err);
    }
    setCapturing(false);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color={GOLD} size="large" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permissionEmoji}>📷</Text>
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionBody}>
              We need camera permission to take a photo of your ID.
            </Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Grant permission</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

            {/* Dimmed mask with a clear rectangular cutout shaped to a
                real ID card's proportions — built from four opaque
                bars (top/bottom/left/right) surrounding an untouched
                gap, rather than an actual cutout shape, since React
                Native has no built-in mask/clip-path primitive for
                this. The gap itself has no overlay at all, so the
                live camera feed shows through it completely clearly;
                only the border around it is drawn, as the visible
                guide. */}
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.maskRow} />
              <View style={styles.maskMiddleRow}>
                <View style={styles.maskSide} />
                <View style={styles.frameGuide} />
                <View style={styles.maskSide} />
              </View>
              <View style={styles.maskRow} />
            </View>

            <View style={styles.instructionBar} pointerEvents="none">
              <Text style={styles.instructionText}>Position your ID within the frame</Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.bottomBar}>
              <TouchableOpacity
                style={[styles.shutterBtn, capturing && { opacity: 0.6 }]}
                onPress={handleCapture}
                disabled={capturing}
              >
                {capturing
                  ? <ActivityIndicator color={BLACK} />
                  : <View style={styles.shutterInner} />
                }
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  permissionEmoji: { fontSize: 48, marginBottom: 16 },
  permissionTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  permissionBody: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 24, lineHeight: 19 },
  permissionBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  permissionBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
  cancelLink: { marginTop: 16 },
  cancelLinkText: { color: '#aaa', fontSize: 13 },

  // NEW: overlay/guide styles. The middle row's height is a fixed
  // proportion of screen height, with frameGuide's width derived from
  // that height via ID_ASPECT_RATIO — this keeps the guide shaped like
  // a real ID card regardless of device screen size, rather than a
  // fixed pixel box that would look right on only one screen size.
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },
  maskRow: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  maskMiddleRow: { flexDirection: 'row', height: '32%' },
  maskSide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  frameGuide: {
    aspectRatio: ID_ASPECT_RATIO,
    borderWidth: 3,
    borderColor: GOLD,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },

  instructionBar: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
  instructionText: {
    color: '#fff', fontSize: 14, fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },

  closeBtn: {
    position: 'absolute', top: 56, right: 20, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  bottomBar: { position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center' },
  shutterBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
});
