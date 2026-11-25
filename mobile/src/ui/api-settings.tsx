import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiUrl, DEFAULT_API_URL, saveApiUrl } from '../api/api-url';
import { normalizeApiUrl } from '../api/normalize-api-url';
import { useSession } from '../session/session-context';
import { TextField } from './text-field';
import { colors, fonts, radius } from './theme';

/**
 * Settings button for internal test builds: lets a tester point the app at another API (for
 * example a backend running on their machine). Only rendered when DEBUG_API is on.
 * A session belongs to the server that issued it, so changing the address signs the user out.
 */
export function ApiSettings() {
  const { session, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show() {
    setValue(apiUrl());
    setError(null);
    setOpen(true);
  }

  async function apply(next: string | null) {
    if ((next ?? DEFAULT_API_URL) === apiUrl()) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      // Sign out against the old server first, while it is still the one being called.
      if (session) await signOut();
      await saveApiUrl(next);
      setOpen(false);
    } catch {
      setError('No se pudo guardar la dirección.');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const url = normalizeApiUrl(value);
    if (!url) {
      setError('Escribe una dirección válida, por ejemplo 192.168.1.20:3000');
      return;
    }
    apply(url);
  }

  return (
    <>
      <Pressable
        onPress={show}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Configuración: servidor de la API"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons name="settings-outline" size={15} color={colors.background} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Cerrar">
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Servidor de la API</Text>
            <Text style={styles.message}>
              Solo en versiones de prueba. Escribe la dirección del backend, por ejemplo la IP de tu máquina en la red local.
              {session ? ' Al cambiarla se cierra la sesión.' : ''}
            </Text>
            <View style={styles.field}>
              <TextField
                label="Dirección"
                value={value}
                onChangeText={(text) => {
                  setValue(text);
                  setError(null);
                }}
                placeholder="192.168.1.20:3000"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                inputMode="url"
                returnKeyType="done"
                onSubmitEditing={save}
                style={styles.input}
              />
            </View>
            <Text style={styles.hint}>Por defecto: {DEFAULT_API_URL}</Text>
            {error && (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <View style={styles.actions}>
              <Pressable
                onPress={() => setOpen(false)}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [styles.action, styles.cancel, pressed && styles.pressed]}
              >
                <Text style={styles.cancelLabel}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [styles.action, styles.confirm, pressed && styles.pressed]}
              >
                <Text style={styles.confirmLabel}>Guardar</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => apply(null)}
              disabled={saving}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
            >
              <Text style={styles.resetLabel}>Usar la dirección por defecto</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Round version of the dark pills it shares the top bar with.
  button: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 57, 58, 0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.background, borderRadius: radius.sheet, padding: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.dark },
  message: { fontFamily: fonts.regular, fontSize: 15, color: colors.dark, marginTop: 10, lineHeight: 21 },
  field: { marginTop: 16 },
  input: { backgroundColor: colors.white },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.disabledText, marginTop: -8 },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  action: { flex: 1, minHeight: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.disabled },
  confirm: { backgroundColor: colors.primary },
  cancelLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark },
  confirmLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.background },
  reset: { alignSelf: 'center', marginTop: 16 },
  resetLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.disabledText, textDecorationLine: 'underline' },
});
