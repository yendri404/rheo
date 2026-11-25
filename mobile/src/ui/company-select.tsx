import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Company } from '../api/types';
import { colors, fonts, radius } from './theme';

type Props = {
  companies: Company[];
  selected: Company;
  onSelect: (companyId: string) => void;
  /** Shown instead of opening the list (e.g. while a route is in progress). */
  lockedReason?: string;
};

/**
 * Dropdown for the driver's top bar: shows the company they are working with and lets them switch.
 * A modal list rather than a native picker so it looks and behaves the same on Android, iOS and web.
 * With a single company there is nothing to choose, so it is a plain label.
 */
export function CompanySelect({ companies, selected, onSelect, lockedReason }: Props) {
  const [open, setOpen] = useState(false);
  const canChoose = companies.length > 1;

  const label = (
    <>
      <Ionicons name="business-outline" size={14} color={colors.background} />
      <Text style={styles.label} numberOfLines={1}>
        {selected.name}
      </Text>
    </>
  );

  if (!canChoose) {
    return (
      <View style={styles.pill} accessibilityLabel={`Empresa: ${selected.name}`}>
        {label}
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Empresa: ${selected.name}. Cambiar de empresa`}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        {label}
        <Ionicons name={lockedReason ? 'lock-closed-outline' : 'chevron-down'} size={14} color={colors.background} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Cerrar">
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Empresa</Text>
            {lockedReason ? (
              <Text style={styles.message}>{lockedReason}</Text>
            ) : (
              <>
                <Text style={styles.message}>Elige con qué empresa quieres ver y ejecutar las rutas.</Text>
                <ScrollView style={styles.list}>
                  {companies.map((company) => {
                    const active = company.id === selected.id;
                    return (
                      <Pressable
                        key={company.id}
                        onPress={() => {
                          setOpen(false);
                          if (!active) onSelect(company.id);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
                      >
                        <Text style={[styles.optionLabel, active && styles.optionLabelActive]} numberOfLines={1}>
                          {company.name}
                        </Text>
                        {active && <Ionicons name="checkmark" size={18} color={colors.background} />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeLabel}>{lockedReason ? 'Entendido' : 'Cancelar'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Same dark pill as the sign-out button it shares the top bar with.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    backgroundColor: colors.dark,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  label: { fontFamily: fonts.regular, color: colors.background, fontSize: 12, flexShrink: 1 },
  pressed: { opacity: 0.8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(34, 57, 58, 0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.background, borderRadius: radius.sheet, padding: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.dark },
  message: { fontFamily: fonts.regular, fontSize: 15, color: colors.dark, marginTop: 10, lineHeight: 21 },
  list: { marginTop: 14, maxHeight: 320 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: radius.control,
    backgroundColor: colors.white,
  },
  optionActive: { backgroundColor: colors.primary },
  optionLabel: { fontFamily: fonts.regular, fontSize: 16, color: colors.dark, flexShrink: 1 },
  optionLabelActive: { fontFamily: fonts.bold, color: colors.background },
  close: {
    minHeight: 48,
    marginTop: 14,
    borderRadius: radius.control,
    backgroundColor: colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.dark },
});
