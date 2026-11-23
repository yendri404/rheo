import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, springs } from './motion';
import { colors, fonts, radius } from './theme';

type Props = {
  /** Short messages (or an illustration) shown on the green background. */
  header?: ReactNode;
  children: ReactNode;
  /** Primary action, pinned to the bottom of the screen (see `footerPosition`). */
  footer?: ReactNode;
  /**
   * - `pinned`: the footer floats at the bottom of the screen (and rides up with the keyboard).
   * - `inline`: the footer sits right after the content and scrolls with it (forms with a keyboard).
   */
  footerPosition?: 'pinned' | 'inline';
  onSignOut?: () => void;
  connected?: boolean;
  /** Changing it replays the entrance animation (header fades in, sheet content springs up). */
  contentKey?: string;
  /**
   * - `fill`: the sheet starts right below the header and fills the screen (forms, lists).
   * - `content`: the sheet hugs its content at the bottom; the green background takes the rest,
   *   leaving room for illustrations (as in the mockup's start and finished screens). The green
   *   area is dotted here, since it is the screen's main focus.
   */
  sheet?: 'fill' | 'content';
  /** Where the header sits inside the green area. `center` is for a hero element such as the finished check; `bottom` rides just above the sheet. */
  headerAlign?: 'top' | 'center' | 'bottom';
  /** Shows the dotted green background drifting diagonally (always on with `sheet="content"`, static there unless set). */
  driftingDots?: boolean;
};

const TOP_BAR_HEIGHT = 40;
const HEADER_JUSTIFY = { top: 'flex-start', center: 'center', bottom: 'flex-end' } as const;
/** Rounded top + handle of the sheet; it sticks to the top when the sheet is fully raised. */
const SHEET_CAP_HEIGHT = 37;
/** Must match the dot grid's `backgroundSize` below. */
const DOT_TILE = 22;

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
  footerPosition = 'pinned',
  onSignOut,
  connected = true,
  contentKey = 'default',
  sheet = 'fill',
  headerAlign = 'top',
  driftingDots = false,
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
  const pinnedFooter = footerPosition === 'pinned' ? footer : null;
  const inlineFooter = footerPosition === 'inline' ? footer : null;
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

  // The grid tile is DOT_TILE px, so sliding the oversized layer one tile loops without a seam.
  const drift = useSharedValue(0);
  useEffect(() => {
    if (!driftingDots || reduceMotion) return;
    drift.value = withRepeat(withTiming(DOT_TILE, { duration: 2400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(drift);
  }, [driftingDots, reduceMotion, drift]);
  const dotsDriftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value }, { translateY: drift.value }],
  }));

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
      {(hugContent || driftingDots) && (
        <Animated.View entering={motion.textEnter} pointerEvents="none" style={styles.dotsClip}>
          <Animated.View style={[styles.dots, driftingDots && !reduceMotion && dotsDriftStyle]} />
        </Animated.View>
      )}
      <View style={[styles.topBar, { paddingTop: insets.top, height: topBarHeight }]}>
        {!connected && (
          <Animated.Text entering={motion.textEnter} style={styles.offline}>
            Reconectando…
          </Animated.Text>
        )}
        {onSignOut && (
          <Pressable
            onPress={onSignOut}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
            style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          >
            <Ionicons name="log-out-outline" size={15} color={colors.background} />
            <Text style={styles.signOutLabel}>Cerrar sesión</Text>
          </Pressable>
        )}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.header,
          { top: topBarHeight, justifyContent: HEADER_JUSTIFY[headerAlign] },
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
        // The sheet's cap (rounded top + handle) sticks once it reaches the top: the sheet stops
        // rising there and only its content keeps scrolling underneath, like a bottom sheet.
        stickyHeaderIndices={[1]}
      >
        <Animated.View style={spacerStyle} />
        <View nativeID="sheet" style={[styles.sheetCap, !shown && styles.unplaced]}>
          <View style={styles.handle} />
        </View>
        <View
          onLayout={(event) => setSheetHeight(SHEET_CAP_HEIGHT + event.nativeEvent.layout.height)}
          style={[
            styles.sheetBody,
            // In fill mode the sheet is tall enough to always slide over the header.
            !hugContent && { minHeight: (viewportHeight ?? windowHeight - topBarHeight) - SHEET_CAP_HEIGHT },
            // Hidden only until the first measurement places it, so it never flashes at the top.
            !shown && styles.unplaced,
          ]}
        >
          <Animated.View key={contentKey} entering={motion.sheetEnter}>
            {children}
            {inlineFooter && <View style={styles.inlineFooter}>{inlineFooter}</View>}
          </Animated.View>
          {/* Room for the pinned footer. A child, not paddingBottom: on web onLayout uses a
              content-box ResizeObserver, which does not fire when only padding changes. */}
          <View style={{ height: (pinnedFooter ? footerHeight : insets.bottom) + 24 }} />
        </View>
      </Animated.ScrollView>

      {pinnedFooter && (
        <View
          style={[styles.footer, !hugContent && styles.footerOverContent, { paddingBottom: insets.bottom + 16 }]}
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        >
          {pinnedFooter}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  // Subtle dot grid on the green area; the sheet covers it wherever it reaches.
  dotsClip: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  // One tile larger than the screen up-left, so drifting down-right never exposes an edge.
  dots: {
    position: 'absolute',
    top: -DOT_TILE,
    left: -DOT_TILE,
    right: 0,
    bottom: 0,
    backgroundImage: 'radial-gradient(circle, rgba(234, 240, 241, 0.22) 1.5px, transparent 2px)',
    backgroundSize: `${DOT_TILE}px ${DOT_TILE}px`,
    backgroundRepeat: 'repeat',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    zIndex: 2,
  },
  offline: { fontFamily: fonts.regular, color: colors.accent, fontSize: 13, flex: 1 },
  // Dark pill with an icon, as in the reference design.
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dark,
    borderRadius: 999,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 12,
  },
  signOutPressed: { opacity: 0.75 },
  signOutLabel: { fontFamily: fonts.regular, color: colors.background, fontSize: 12 },
  header: { position: 'absolute', left: 0, right: 0 },
  headerContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32 },
  scroll: { flex: 1 },
  sheetCap: {
    height: SHEET_CAP_HEIGHT,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet + 8,
    borderTopRightRadius: radius.sheet + 8,
    alignItems: 'center',
    paddingTop: 12,
    // Negative spread keeps the shadow above the cap; it must not bleed down onto the body.
    boxShadow: '0px -14px 24px -10px rgba(0, 0, 0, 0.3)',
    zIndex: 1,
  },
  sheetBody: { backgroundColor: colors.background, paddingHorizontal: 24 },
  unplaced: { opacity: 0 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.disabled },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.background,
  },
  inlineFooter: { marginTop: 24 },
  // Only where content can scroll beneath it: a soft upward shadow reads as content passing under.
  footerOverContent: { boxShadow: '0px -6px 14px rgba(0, 0, 0, 0.08)' },
});
