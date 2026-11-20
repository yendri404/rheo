import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Checkmark } from './checkmark';
import { COLOR_TRANSITION_MS, springs } from './motion';
import { colors, fonts, radius } from './theme';

type Props = {
  name: string;
  address: string;
  confirmed: boolean;
  loading: boolean;
  onConfirm: () => void;
};

const DONE_ROW = '#D3DCDD';

/**
 * Pending rows stand out (dark action with a check to tap).
 * Confirmed rows keep the check but fade to grey so they stop drawing attention;
 * the change animates, with a small pop on the check.
 */
export function PassengerRow({ name, address, confirmed, loading, onConfirm }: Props) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(confirmed ? 1 : 0);
  const checkScale = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(confirmed ? 1 : 0, { duration: COLOR_TRANSITION_MS });
    if (confirmed && !reduceMotion) {
      checkScale.value = withSequence(withSpring(1.35, springs.popOut), withSpring(1, springs.popBack));
    }
  }, [confirmed, reduceMotion, progress, checkScale]);

  const rowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.disabled, DONE_ROW]),
  }));
  const textStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value * 0.45 }));
  const actionStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.dark, colors.disabled]),
  }));
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <Animated.View style={[styles.text, textStyle]}>
        <Text style={[styles.name, confirmed && styles.textDone]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.address, confirmed && styles.textDone]} numberOfLines={2}>
          {address || 'Sin dirección'}
        </Text>
      </Animated.View>
      <Pressable
        onPress={onConfirm}
        disabled={confirmed || loading}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={confirmed ? `Parada de ${name} confirmada` : `Confirmar parada de ${name}`}
        accessibilityState={{ disabled: confirmed || loading, checked: confirmed }}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.action, actionStyle]}>
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Animated.View style={checkStyle}>
              <Checkmark size={20} color={confirmed ? colors.background : colors.accent} />
            </Animated.View>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.control,
    overflow: 'hidden',
    marginBottom: 10,
  },
  text: { flex: 1, paddingVertical: 12, paddingHorizontal: 14 },
  name: { fontFamily: fonts.bold, fontSize: 17, color: colors.dark },
  address: { fontFamily: fonts.regular, fontSize: 13, color: colors.dark, marginTop: 4 },
  textDone: { color: colors.disabledText },
  pressable: { width: 60 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
