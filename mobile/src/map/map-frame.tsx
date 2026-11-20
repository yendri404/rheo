import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { COLOR_TRANSITION_MS } from '../ui/motion';
import { colors, radius } from '../ui/theme';

type Props = { near: boolean; height: number; children: ReactNode };

/** Map border: green normally, the ticket's yellow while the driver is near. */
export function MapFrame({ near, height, children }: Props) {
  const progress = useSharedValue(near ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(near ? 1 : 0, { duration: COLOR_TRANSITION_MS });
  }, [near, progress]);

  // Reads the shared value directly: on web, Reanimated tracks dependencies from this closure.
  const border = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [colors.primary, colors.accent]),
  }));

  return (
    <Animated.View
      nativeID="driver-map-frame"
      accessibilityLabel={near ? 'Mapa: el chofer está cerca' : 'Mapa del recorrido del chofer'}
      style={[styles.frame, { height }, border]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.sheet,
    borderWidth: 4,
    overflow: 'hidden',
    backgroundColor: colors.disabled,
  },
});
