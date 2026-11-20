import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { COLOR_TRANSITION_MS, motion } from './motion';
import { colors, fonts, radius } from './theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

/** Fades between enabled/disabled colors and pops once when it becomes available. */
export function PrimaryButton({ label, onPress, disabled = false, loading = false }: Props) {
  const inactive = disabled || loading;
  const reduceMotion = useReducedMotion();
  const enabled = useSharedValue(disabled ? 0 : 1);
  const scale = useSharedValue(1);
  const wasDisabled = useRef(disabled);

  useEffect(() => {
    enabled.value = withTiming(disabled ? 0 : 1, { duration: COLOR_TRANSITION_MS });
    if (wasDisabled.current && !disabled && !reduceMotion) {
      scale.value = withSequence(withSpring(1.05, { damping: 8 }), withSpring(1, { damping: 12 }));
    }
    wasDisabled.current = disabled;
  }, [disabled, reduceMotion, enabled, scale]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(enabled.value, [0, 1], [colors.disabled, colors.primary]),
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => pressed && !inactive && styles.pressed}
    >
      <Animated.View style={[styles.button, animated]}>
        {loading ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          // Re-keyed so a new label ("Usaré el transporte" -> "Confirmado") fades in.
          <Animated.Text key={label} entering={motion.textEnter} style={[styles.label, disabled && styles.disabledLabel]}>
            {label}
          </Animated.Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { fontFamily: fonts.bold, fontSize: 17, color: colors.background },
  disabledLabel: { color: colors.disabledText },
});
