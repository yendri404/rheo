import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { COLOR_TRANSITION_MS, springs } from './motion';
import { colors, fonts } from './theme';

/** Compact and large geometry: height, arrow tip width and label size. */
const COMPACT = { height: 56, tip: 18, font: 32 };
// 56px is the largest size where the longest route name ("Mañana") still fits on a phone.
const LARGE = { height: 124, tip: 32, font: 56 };

type Props = {
  label: string;
  highlighted: boolean;
  /** `large` puts the route center stage; `compact` frees space below it (e.g. for a map). */
  size?: 'compact' | 'large';
};

/**
 * Arrow-shaped route tag ("ticket") from the passenger mockup.
 * Yellow and gently pulsing while the passenger has something to do; fades to green once done.
 * Changing `size` springs the whole ticket (height, arrow and text) between its two sizes.
 */
export function RouteBanner({ label, highlighted, size = 'compact' }: Props) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(highlighted ? 1 : 0);
  const pulse = useSharedValue(1);
  const grow = useSharedValue(size === 'large' ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(highlighted ? 1 : 0, { duration: COLOR_TRANSITION_MS });
    if (highlighted && !reduceMotion) {
      pulse.value = withRepeat(withSequence(withTiming(1.035, { duration: 650 }), withTiming(1, { duration: 650 })), -1);
    } else {
      // Assigning a new animation replaces the repeating pulse.
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [highlighted, reduceMotion, progress, pulse]);

  useEffect(() => {
    const next = size === 'large' ? 1 : 0;
    grow.value = reduceMotion ? next : withSpring(next, springs.sheet);
  }, [size, reduceMotion, grow]);

  // Each animated style must read a shared value directly: on web, Reanimated tracks dependencies
  // from the style's own closure, so a value hidden behind a helper function never re-triggers it.
  const fill = useDerivedValue(() => interpolateColor(progress.value, [0, 1], [colors.primary, colors.accent]));
  const height = useDerivedValue(() => interpolate(grow.value, [0, 1], [COMPACT.height, LARGE.height]));
  const tip = useDerivedValue(() => interpolate(grow.value, [0, 1], [COMPACT.tip, LARGE.tip]));

  const rowStyle = useAnimatedStyle(() => ({ height: height.value, transform: [{ scale: pulse.value }] }));
  const bodyStyle = useAnimatedStyle(() => ({ backgroundColor: fill.value }));
  const notchStyle = useAnimatedStyle(() => ({
    width: tip.value,
    borderLeftWidth: tip.value,
    borderTopWidth: height.value / 2,
    borderBottomWidth: height.value / 2,
    borderTopColor: fill.value,
    borderBottomColor: fill.value,
  }));
  const tipStyle = useAnimatedStyle(() => ({
    borderLeftWidth: tip.value,
    borderTopWidth: height.value / 2,
    borderBottomWidth: height.value / 2,
    borderLeftColor: fill.value,
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.background, colors.dark]),
    fontSize: interpolate(grow.value, [0, 1], [COMPACT.font, LARGE.font]),
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]} accessible accessibilityLabel={`Ruta ${label}`}>
      <Animated.View style={[styles.notch, notchStyle]} />
      <Animated.View style={[styles.body, bodyStyle]}>
        <Animated.Text style={[styles.label, textStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
      <Animated.View style={[styles.tip, tipStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  // 1px overlaps hide the sub-pixel seams that scaling (the pulse) exposes between the pieces.
  notch: { borderLeftColor: 'transparent', marginRight: -1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 4 },
  tip: { borderTopColor: 'transparent', borderBottomColor: 'transparent', marginLeft: -1 },
  label: { fontFamily: fonts.regular },
});
