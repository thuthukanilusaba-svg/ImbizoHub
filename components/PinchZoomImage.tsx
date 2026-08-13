// components/PinchZoomImage.tsx
//
// Hand-built replacement for the pinch-to-zoom behaviour that
// react-native-image-viewing used to provide. That library is
// unmaintained and doesn't render correctly under React Native's New
// Architecture — photos opened full-screen showed zoomed in/cropped,
// never the whole image. Rather than fight a dead dependency, this
// renders a single photo using only native modules the app already
// ships (react-native-gesture-handler, react-native-reanimated,
// react-native-worklets, expo-image), so this whole feature is pure JS
// on top of an already-compiled binary — no new native build needed.
//
// Gestures supported:
//  - Pinch to zoom (1x - 4x), anchored where you'd expect.
//  - Pan to move around while zoomed in.
//  - Double-tap to toggle between 1x and 2.5x.
//  - Swipe left/right to move to the next/previous photo (only while
//    NOT zoomed in, so it never fights with panning a zoomed photo).
//  - Swipe down to dismiss the viewer (only while NOT zoomed in).

import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Dimensions, StyleSheet } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_THRESHOLD = 80;
const DISMISS_THRESHOLD = 110;

type Props = {
  uri: string;
  onNext: () => void;
  onPrev: () => void;
  onDismiss: () => void;
  hasNext: boolean;
  hasPrev: boolean;
};

export default function PinchZoomImage({ uri, onNext, onPrev, onDismiss, hasNext, hasPrev }: Props) {
  // Pinch-zoom state
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  // Pan-while-zoomed state
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Whole-image drag state (swipe between photos / swipe down to dismiss),
  // only meaningful while scale === 1.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const resetZoom = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        resetZoom();
      } else if (scale.value > MAX_SCALE) {
        scale.value = withTiming(MAX_SCALE);
        savedScale.value = MAX_SCALE;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else if (e.numberOfPointers === 1) {
        // Only treat a single-finger drag as "swipe to next photo /
        // swipe down to dismiss" — a 2-finger drag while not zoomed in
        // is the start of a pinch gesture, not a swipe, and shouldn't
        // be misread as one.
        dragX.value = e.translationX;
        dragY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      if (e.numberOfPointers !== 1 && dragX.value === 0 && dragY.value === 0) {
        return;
      }

      const absX = Math.abs(dragX.value);
      const absY = Math.abs(dragY.value);

      if (absX > absY && absX > SWIPE_THRESHOLD) {
        if (dragX.value < 0 && hasNext) {
          scheduleOnRN(onNext);
        } else if (dragX.value > 0 && hasPrev) {
          scheduleOnRN(onPrev);
        }
        dragX.value = withTiming(0);
        dragY.value = withTiming(0);
      } else if (dragY.value > DISMISS_THRESHOLD && absY > absX) {
        scheduleOnRN(onDismiss);
        dragX.value = withTiming(0);
        dragY.value = withTiming(0);
      } else {
        dragX.value = withSpring(0);
        dragY.value = withSpring(0);
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        resetZoom();
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  const panAndPinch = Gesture.Simultaneous(pinchGesture, panGesture);
  const composedGesture = Gesture.Exclusive(doubleTapGesture, panAndPinch);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + dragX.value },
      { translateY: translateY.value + dragY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.container, animatedStyle]}>
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          transition={0}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
});
