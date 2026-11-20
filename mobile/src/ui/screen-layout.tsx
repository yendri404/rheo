import { useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from './theme';

type Props = {
  /** Short messages shown on the green background, behind the sheet. */
  header: ReactNode;
  children: ReactNode;
  /** Primary action, pinned to the bottom of the screen. */
  footer?: ReactNode;
  onSignOut?: () => void;
  connected?: boolean;
};

const TOP_BAR_HEIGHT = 40;

/**
 * Green app background with short messages on top, and a light sheet that scrolls up over them.
 * As the sheet rises, the header recedes (fades, shrinks and drifts up): a simple depth effect.
 */
export function ScreenLayout({ header, children, footer, onSignOut, connected = true }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const topBarHeight = insets.top + TOP_BAR_HEIGHT;
  const travel = Math.max(headerHeight, 1);
  const receding = {
    opacity: scrollY.interpolate({ inputRange: [0, travel * 0.8], outputRange: [1, 0], extrapolate: 'clamp' }),
    transform: [
      { translateY: scrollY.interpolate({ inputRange: [0, travel], outputRange: [0, -travel * 0.3], extrapolate: 'clamp' }) },
      { scale: scrollY.interpolate({ inputRange: [0, travel], outputRange: [1, 0.88], extrapolate: 'clamp' }) },
    ],
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top, height: topBarHeight }]}>
        {!connected && <Text style={styles.offline}>Reconectando…</Text>}
        {onSignOut && (
          <Pressable onPress={onSignOut} hitSlop={12} accessibilityRole="button">
            <Text style={styles.signOut}>Cerrar sesión</Text>
          </Pressable>
        )}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[styles.header, { top: topBarHeight }, receding]}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
      >
        {header}
      </Animated.View>

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: headerHeight }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: Platform.OS !== 'web',
        })}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Tall enough to always slide over the header, even with little content. */}
        <View style={[styles.sheet, { minHeight: height - topBarHeight, paddingBottom: footerHeight + 24 }]}>
          <View style={styles.handle} />
          {children}
        </View>
      </Animated.ScrollView>

      {footer && (
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    zIndex: 2,
  },
  offline: { fontFamily: fonts.regular, color: colors.accent, fontSize: 13, flex: 1 },
  signOut: { fontFamily: fonts.regular, color: colors.background, fontSize: 13, opacity: 0.85 },
  header: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 },
  scroll: { flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet + 8,
    borderTopRightRadius: radius.sheet + 8,
    paddingHorizontal: 24,
    paddingTop: 12,
    boxShadow: '0px -10px 28px rgba(0, 0, 0, 0.22)',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.disabled,
    marginBottom: 20,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.background,
    // Soft upward shadow so scrolled content reads as passing underneath the action bar.
    boxShadow: '0px -6px 14px rgba(0, 0, 0, 0.08)',
  },
});
