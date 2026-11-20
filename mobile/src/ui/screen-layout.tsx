import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, springs } from './motion';
import { colors, fonts, radius } from './theme';

type Props = {
  /** Short messages (or an illustration) shown on the green background. */
  header?: ReactNode;
  children: ReactNode;
  /** Primary action, pinned to the bottom of the screen. */
  footer?: ReactNode;
  onSignOut?: () => void;
  connected?: boolean;
  /** Changing it replays the entrance animation (header fades in, sheet content springs up). */
  contentKey?: string;
  /**
   * - `fill`: the sheet starts right below the header and fills the screen (forms, lists).
   * - `content`: the sheet hugs its content at the bottom; the green background takes the rest,
   *   leaving room for illustrations (as in the mockup's start and finished screens).
   */
  sheet?: 'fill' | 'content';
  /** Where the header sits inside the green area. `center` is for a hero element such as the finished check. */
  headerAlign?: 'top' | 'center';
};

const TOP_BAR_HEIGHT = 40;

/**
 * Green app background with a light sheet in front of it.
 *
 * The sheet sits below an animated spacer. The spacer's height is the green area: it springs
 * toward a target computed from measurements, so the sheet rises and falls with its content
 * without ever jumping (layout never moves it abruptly; new measurements only retarget the spring).
 * With long content the sheet scrolls over the header, which recedes (fades, shrinks, drifts up).
 */
export function ScreenLayout({
  header,
  children,
  footer,
  onSignOut,
  connected = true,
  contentKey = 'default',
  sheet = 'fill',
  headerAlign = 'top',
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const scrollY = useSharedValue(0);
  const travel = useSharedValue(1);
  const spacer = useSharedValue(0);
  const placed = useRef(false);

  // The header is re-keyed per phase, so it always remounts and reports its size; tagging the
  // measurement with its key lets the spring wait for the current phase's header instead of
  // starting toward a stale target and correcting mid-flight.
  const [headerMeasure, setHeaderMeasure] = useState<{ key: string; height: number } | null>(null);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const [shown, setShown] = useState(false);

  const topBarHeight = insets.top + TOP_BAR_HEIGHT;
  const hugContent = sheet === 'content';
  const headerHeight = headerMeasure?.key === contentKey ? headerMeasure.height : null;
  const ready = headerHeight !== null && sheetHeight !== null && viewportHeight !== null;
  // Green area above the sheet: just the header when filling, everything left over when hugging content.
  const target = !ready ? null : hugContent ? Math.max(headerHeight, viewportHeight - sheetHeight) : headerHeight;

  useEffect(() => {
    if (target === null) return; // Keep the sheet where it is until the new phase is measured.
    if (!placed.current || reduceMotion) {
      placed.current = true;
      spacer.value = target;
      setShown(true);
    } else {
      spacer.value = withSpring(target, springs.sheet);
    }
  }, [target, reduceMotion, spacer]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const spacerStyle = useAnimatedStyle(() => ({ height: spacer.value }));
  // The header area follows the spacer so a centered hero stays centered while the sheet moves.
  const headerAreaStyle = useAnimatedStyle(() => ({ height: Math.max(spacer.value, 1) }));
  const receding = useAnimatedStyle(() => {
    const distance = travel.value;
    return {
      opacity: interpolate(scrollY.value, [0, distance * 0.8], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(scrollY.value, [0, distance], [0, -distance * 0.3], Extrapolation.CLAMP) },
        { scale: interpolate(scrollY.value, [0, distance], [1, 0.88], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top, height: topBarHeight }]}>
        {!connected && (
          <Animated.Text entering={motion.textEnter} style={styles.offline}>
            Reconectando…
          </Animated.Text>
        )}
        {onSignOut && (
          <Pressable onPress={onSignOut} hitSlop={12} accessibilityRole="button">
            <Text style={styles.signOut}>Cerrar sesión</Text>
          </Pressable>
        )}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.header,
          { top: topBarHeight, justifyContent: headerAlign === 'center' ? 'center' : 'flex-start' },
          headerAreaStyle,
          receding,
        ]}
      >
        <Animated.View
          key={contentKey}
          entering={motion.textEnter}
          style={styles.headerContent}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setHeaderMeasure({ key: contentKey, height });
            travel.value = Math.max(height, 1);
          }}
        >
          {header}
        </Animated.View>
      </Animated.View>

      <Animated.ScrollView
        style={styles.scroll}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={spacerStyle} />
        <View
          nativeID="sheet"
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            // In fill mode the sheet is tall enough to always slide over the header.
            !hugContent && { minHeight: (viewportHeight ?? windowHeight - topBarHeight) },
            // Hidden only until the first measurement places it, so it never flashes at the top.
            !shown && styles.unplaced,
          ]}
        >
          <View style={styles.handle} />
          <Animated.View key={contentKey} entering={motion.sheetEnter}>
            {children}
          </Animated.View>
          {/* Room for the pinned footer. A child, not paddingBottom: on web onLayout uses a
              content-box ResizeObserver, which does not fire when only padding changes. */}
          <View style={{ height: footerHeight + 24 }} />
        </View>
      </Animated.ScrollView>

      {footer && (
        <View
          style={[styles.footer, !hugContent && styles.footerOverContent, { paddingBottom: insets.bottom + 16 }]}
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
  header: { position: 'absolute', left: 0, right: 0 },
  headerContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 },
  scroll: { flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet + 8,
    borderTopRightRadius: radius.sheet + 8,
    paddingHorizontal: 24,
    paddingTop: 12,
    boxShadow: '0px -10px 28px rgba(0, 0, 0, 0.22)',
  },
  unplaced: { opacity: 0 },
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
  },
  // Only where content can scroll beneath it: a soft upward shadow reads as content passing under.
  footerOverContent: { boxShadow: '0px -6px 14px rgba(0, 0, 0, 0.08)' },
});
