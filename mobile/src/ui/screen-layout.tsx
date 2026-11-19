import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius } from './theme';

type Props = {
  /** Content of the green band at the top. */
  header: ReactNode;
  children: ReactNode;
  /** Pinned to the bottom of the light sheet (primary action). */
  footer?: ReactNode;
  headerHeight?: number | `${number}%`;
  onSignOut?: () => void;
  connected?: boolean;
};

/** Green header band + light rounded sheet, the frame of every screen in the mockup. */
export function ScreenLayout({ header, children, footer, headerHeight = '22%', onSignOut, connected = true }: Props) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={[styles.header, { minHeight: headerHeight }]}>
        <View style={styles.topBar}>
          {!connected && <Text style={styles.offline}>Reconectando…</Text>}
          {onSignOut && (
            <Pressable onPress={onSignOut} hitSlop={12} accessibilityRole="button">
              <Text style={styles.signOut}>Cerrar sesión</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.headerContent}>{header}</View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.body}>{children}</View>
        {footer && <View style={styles.footer}>{footer}</View>}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  header: { paddingHorizontal: 24, paddingBottom: 28 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16, minHeight: 32 },
  offline: { fontFamily: fonts.regular, color: colors.accent, fontSize: 13, flex: 1 },
  signOut: { fontFamily: fonts.regular, color: colors.background, fontSize: 13, opacity: 0.85 },
  headerContent: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    marginTop: -radius.sheet,
  },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 12 },
});
