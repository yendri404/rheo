import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from './theme';

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** Extra facts the user should verify before confirming (e.g. route, passenger count). */
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
};

type DialogProps = ConfirmOptions & { visible: boolean; onConfirm: () => void; onCancel: () => void };

/** Cross-platform modal (Alert.alert does nothing on web). */
export function ConfirmDialog({ visible, title, message, details, confirmLabel, cancelLabel = 'Cancelar', onConfirm, onCancel }: DialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Cerrar">
        <Pressable style={styles.card} accessibilityRole="alert" onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}
          {details && details.length > 0 && (
            <View style={styles.details}>
              {details.map((detail) => (
                <Text key={detail} style={styles.detail}>
                  • {detail}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.confirm, pressed && styles.pressed]}
            >
              <Text style={styles.confirmLabel}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * const { confirm, dialog } = useConfirm();
 * if (await confirm({ title, confirmLabel })) doIt();
 * ...render {dialog} once in the screen.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = options ? (
    <ConfirmDialog visible {...options} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
  ) : null;

  return { confirm, dialog };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 57, 58, 0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.background, borderRadius: radius.sheet, padding: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.dark },
  message: { fontFamily: fonts.regular, fontSize: 15, color: colors.dark, marginTop: 10, lineHeight: 21 },
  details: { marginTop: 12, padding: 12, borderRadius: radius.control, backgroundColor: colors.white },
  detail: { fontFamily: fonts.regular, fontSize: 14, color: colors.dark, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  button: { flex: 1, minHeight: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.disabled },
  confirm: { backgroundColor: colors.primary },
  pressed: { opacity: 0.85 },
  cancelLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark },
  confirmLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.background },
});
