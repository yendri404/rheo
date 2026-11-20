import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { COLOR_TRANSITION_MS } from './motion';
import { colors, fonts } from './theme';

const HEIGHT = 56;
const TIP = 18;

type Props = { label: string; highlighted: boolean };

/**
 * Arrow-shaped route tag from the passenger mockup.
 * Yellow and gently pulsing while the passenger has something to do; fades to green once done.
 */
export function RouteBanner({ label, highlighted }: Props) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(highlighted ? 1 : 0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(highlighted ? 1 : 0, { duration: COLOR_TRANSITION_MS });
    if (highlighted && !reduceMotion) {
      pulse.value = withRepeat(withSequence(withTiming(1.035, { duration: 650 }), withTiming(1, { duration: 650 })), -1);
    } else {
      // Assigning a new animation replaces the repeating pulse.
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [highlighted, reduceMotion, progress, pulse]);

  // Each animated style must read a shared value directly: on web, Reanimated tracks dependencies
  // from the style's own closure, so a value hidden behind a helper function never re-triggers it.
  const fill = useDerivedValue(() => interpolateColor(progress.value, [0, 1], [colors.primary, colors.accent]));
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const bodyStyle = useAnimatedStyle(() => ({ backgroundColor: fill.value }));
  const notchStyle = useAnimatedStyle(() => ({ borderTopColor: fill.value, borderBottomColor: fill.value }));
  const tipStyle = useAnimatedStyle(() => ({ borderLeftColor: fill.value }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.background, colors.dark]),
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]} accessible accessibilityLabel={`Ruta ${label}`}>
      <Animated.View style={[styles.notch, notchStyle]} />
      <Animated.View style={[styles.body, bodyStyle]}>
        <Animated.Text style={[styles.label, textStyle]}>{label}</Animated.Text>
      </Animated.View>
      <Animated.View style={[styles.tip, tipStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', height: HEIGHT },
  notch: {
    width: TIP,
    borderTopWidth: HEIGHT / 2,
    borderBottomWidth: HEIGHT / 2,
    borderLeftWidth: TIP,
    borderLeftColor: 'transparent',
  },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 4 },
  tip: {
    borderTopWidth: HEIGHT / 2,
    borderBottomWidth: HEIGHT / 2,
    borderLeftWidth: TIP,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  label: { fontFamily: fonts.regular, fontSize: 32 },
});
